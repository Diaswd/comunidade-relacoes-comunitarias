begin;
-- Deletion is reversible. Files remain private and hidden while in the trash.
create table rc_private.deleted_records (
 kind text not null check(kind in ('demand','event','referral','attachment')),
 id uuid not null, "deletedAt" timestamptz not null default now(),
 "deletedBy" uuid not null references public.rc_members(id), primary key(kind,id)
);
create index deleted_records_actor_idx on rc_private.deleted_records("deletedBy");
alter table rc_private.deleted_records enable row level security;
revoke all on rc_private.deleted_records from public,anon,authenticated;
create policy internal_only on rc_private.deleted_records using(false);

create table public.rc_attachments (
 id uuid primary key default gen_random_uuid(),
 "demandId" uuid references public.rc_demands(id) on delete restrict,
 "eventId" uuid references public.rc_events(id) on delete restrict,
 bucket text not null check(bucket in ('rc-files','rc-demand-photos')),
 path text not null, name text not null check(char_length(name) between 1 and 180),
 mime text not null check(char_length(mime) between 1 and 255),
 size bigint not null check(size between 1 and 52428800),
 "uploadedBy" uuid not null references public.rc_members(id),
 "createdAt" timestamptz not null default now(), version integer not null default 1,
 check(num_nonnulls("demandId","eventId")=1), unique(bucket,path)
);
create index rc_attachments_demand_idx on public.rc_attachments("demandId","createdAt");
create index rc_attachments_event_idx on public.rc_attachments("eventId","createdAt");
create index rc_attachments_actor_idx on public.rc_attachments("uploadedBy");
alter table public.rc_attachments enable row level security;
revoke all on public.rc_attachments from public,anon,authenticated;
grant select on public.rc_attachments to authenticated;
insert into public.rc_attachments(id,"demandId",bucket,path,name,mime,size,"uploadedBy","createdAt")
 select id,"demandId",'rc-demand-photos',path,name,'image/jpeg',size,"uploadedBy","createdAt" from public.rc_demand_photos;

create function rc_private.record_available(p_kind text,p_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if rc_private.current_role() is null or exists(select 1 from rc_private.deleted_records where kind=p_kind and id=p_id) then return false; end if;
 if p_kind='demand' then return exists(select 1 from public.rc_demands where id=p_id);
 elsif p_kind='event' then return exists(select 1 from public.rc_events where id=p_id);
 elsif p_kind='referral' then return exists(select 1 from public.rc_referrals where id=p_id and rc_private.record_available('demand',"demandId"));
 elsif p_kind='attachment' then return exists(select 1 from public.rc_attachments where id=p_id and
   case when "demandId" is not null then rc_private.record_available('demand',"demandId") else rc_private.record_available('event',"eventId") end);
 end if;
 return false;
end $$;
revoke all on function rc_private.record_available(text,uuid) from public,anon,authenticated;
grant execute on function rc_private.record_available(text,uuid) to authenticated;
drop policy team_read on public.rc_demands;
drop policy team_read on public.rc_events;
drop policy team_read on public.rc_referrals;
create policy team_read on public.rc_demands for select to authenticated using(rc_private.record_available('demand',id));
create policy team_read on public.rc_events for select to authenticated using(rc_private.record_available('event',id));
create policy team_read on public.rc_referrals for select to authenticated using(rc_private.record_available('referral',id));
create policy team_attachment_read on public.rc_attachments for select to authenticated using(rc_private.record_available('attachment',id));
drop policy team_photo_read on public.rc_demand_photos;
create policy team_photo_read on public.rc_demand_photos for select to authenticated using(rc_private.record_available('attachment',id));
create function rc_private.copy_legacy_photo() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.rc_attachments(id,"demandId",bucket,path,name,mime,size,"uploadedBy","createdAt")
 values(new.id,new."demandId",'rc-demand-photos',new.path,new.name,'image/jpeg',new.size,new."uploadedBy",new."createdAt");
 return new;
end $$;
revoke all on function rc_private.copy_legacy_photo() from public,anon,authenticated;
create trigger copy_legacy_photo after insert on public.rc_demand_photos for each row execute function rc_private.copy_legacy_photo();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('rc-files','rc-files',false,52428800,null);
create function rc_private.can_upload_attachment(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare k text; target uuid;
begin
 if rc_private.current_role() not in ('Coordenação','Equipe') or rc_private.current_role() is null then return false; end if;
 if p_path is null or p_path !~ '^(demand|event)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 k:=split_part(p_path,'/',1); target:=split_part(p_path,'/',2)::uuid;
 return rc_private.record_available(k,target) and
  (select count(*) from public.rc_attachments a where case when k='demand' then a."demandId"=target else a."eventId"=target end)<50;
end $$;
create policy rc_files_upload on storage.objects for insert to authenticated
 with check(bucket_id='rc-files' and rc_private.can_upload_attachment(name));
create policy rc_files_download on storage.objects for select to authenticated
 using(bucket_id in ('rc-files','rc-demand-photos') and exists(select 1 from public.rc_attachments a where a.bucket=storage.objects.bucket_id and a.path=storage.objects.name));

create function rc_private.register_attachment(p_kind text,p_id uuid,p_path text,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.rc_members; a public.rc_attachments; obj storage.objects; bytes bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('rc_workspace_writes',0));
 m:=rc_private.require_member();
 if m.role='Consulta' then raise exception 'Seu perfil permite apenas consulta.' using errcode='42501'; end if;
 if p_kind not in ('demand','event') or p_kind is null or p_id is null or p_path is null or split_part(p_path,'/',1)<>p_kind or split_part(p_path,'/',2)<>p_id::text then raise exception 'Arquivo não pertence ao registro.'; end if;
 if not rc_private.record_available(p_kind,p_id) then raise exception 'Registro indisponível ou excluído.'; end if;
 select * into a from public.rc_attachments where bucket='rc-files' and path=p_path;
 if a.id is not null then
  if a."uploadedBy"<>m.id or not rc_private.record_available('attachment',a.id) then raise exception 'Envio indisponível.' using errcode='42501'; end if;
  return to_jsonb(a);
 end if;
 if not rc_private.can_upload_attachment(p_path) then raise exception 'Registro inválido ou limite de 50 anexos atingido (incluindo a lixeira).'; end if;
 select * into obj from storage.objects where bucket_id='rc-files' and name=p_path and owner_id=m."authId"::text;
 if obj.id is null then raise exception 'Conclua o envio do arquivo antes de registrá-lo.'; end if;
 bytes:=(obj.metadata->>'size')::bigint;
 if bytes is null or bytes not between 1 and 52428800 then raise exception 'Arquivo vazio ou acima de 50 MB.'; end if;
 insert into public.rc_attachments("demandId","eventId",bucket,path,name,mime,size,"uploadedBy")
 values(case when p_kind='demand' then p_id end,case when p_kind='event' then p_id end,'rc-files',p_path,btrim(p_name),coalesce(nullif(obj.metadata->>'mimetype',''),'application/octet-stream'),bytes,m.id) returning * into a;
 perform rc_private.audit(m,p_id::text,'Arquivo adicionado',null,to_jsonb(a),a.name);
 return to_jsonb(a);
end $$;
create function public.rc_register_attachment(p_kind text,p_id uuid,p_path text,p_name text) returns jsonb
language sql security invoker set search_path='' as $$select rc_private.register_attachment(p_kind,p_id,p_path,p_name)$$;

create function rc_private.set_deleted(p_kind text,p_id uuid,p_version integer,p_restore boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.rc_members; tbl text; old jsonb; result jsonb; deleted boolean; e public.rc_events; parent_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('rc_workspace_writes',0));
 m:=rc_private.require_member();
 if m.role='Consulta' or (p_restore and m.role<>'Coordenação') then raise exception 'Seu perfil não permite esta operação.' using errcode='42501'; end if;
 if p_restore is null then raise exception 'Operação inválida.'; end if;
 tbl:=case p_kind when 'demand' then 'rc_demands' when 'event' then 'rc_events' when 'referral' then 'rc_referrals' when 'attachment' then 'rc_attachments' end;
 if tbl is null then raise exception 'Operação inválida.'; end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1 for update',tbl) into old using p_id;
 if old is null then raise exception 'Registro não encontrado.'; end if;
 if (old->>'version')::integer is distinct from p_version then raise exception 'Registro atualizado por outra pessoa. Atualize a lista e tente novamente.' using errcode='40001'; end if;
 select exists(select 1 from rc_private.deleted_records where kind=p_kind and id=p_id) into deleted;
 if p_restore<>deleted then raise exception 'Registro já excluído ou já recuperado. Atualize a lista.'; end if;
 if p_restore then
  if p_kind in ('referral','attachment') then
   parent_id:=coalesce((old->>'demandId')::uuid,(old->>'eventId')::uuid);
   if not rc_private.record_available(case when old->>'demandId' is not null then 'demand' else 'event' end,parent_id) then raise exception 'Recupere primeiro a demanda ou o compromisso vinculado.'; end if;
  end if;
  if p_kind='event' then
   e:=jsonb_populate_record(null::public.rc_events,old);
   if e.status<>'Cancelado' and exists(select 1 from public.rc_events x where x.id<>p_id and rc_private.record_available('event',x.id) and x.status<>'Cancelado' and x."ownerId"=e."ownerId" and x.date=e.date and x.time<e."endTime" and x."endTime">e.time) then raise exception 'Existe outro compromisso neste horário. Ajuste-o antes de recuperar.' using errcode='23P01'; end if;
  end if;
  delete from rc_private.deleted_records where kind=p_kind and id=p_id;
 else
  if not rc_private.record_available(p_kind,p_id) then raise exception 'Registro indisponível ou excluído.'; end if;
  insert into rc_private.deleted_records(kind,id,"deletedBy") values(p_kind,p_id,m.id);
 end if;
 execute format('update public.%I set version=version+1 where id=$1 returning to_jsonb(%I.*)',tbl,tbl) into result using p_id;
 perform rc_private.audit(m,case when p_kind in ('referral','attachment') then coalesce(old->>'demandId',old->>'eventId') else p_id::text end,
  case when p_restore then 'Registro recuperado' else 'Registro excluído' end,old,result||jsonb_build_object('excluded',not p_restore,'kind',p_kind));
 return result;
end $$;
create function public.rc_set_deleted(p_kind text,p_id uuid,p_version integer,p_restore boolean default false) returns jsonb
language sql security invoker set search_path='' as $$select rc_private.set_deleted(p_kind,p_id,p_version,p_restore)$$;

create function rc_private.trash() returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.rc_members;
begin
 m:=rc_private.require_member();
 if m.role<>'Coordenação' then raise exception 'Somente a coordenação recupera registros.' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('kind',d.kind,'id',d.id,'deletedAt',d."deletedAt",'actor',actor_member.name,'title',coalesce(a.title,e.title,r.department,f.name),'version',coalesce(a.version,e.version,r.version,f.version)) order by d."deletedAt" desc),'[]'::jsonb)
 from rc_private.deleted_records d join public.rc_members actor_member on actor_member.id=d."deletedBy"
 left join public.rc_demands a on d.kind='demand' and a.id=d.id
 left join public.rc_events e on d.kind='event' and e.id=d.id
 left join public.rc_referrals r on d.kind='referral' and r.id=d.id
 left join public.rc_attachments f on d.kind='attachment' and f.id=d.id);
end $$;
create function public.rc_trash() returns jsonb language sql security invoker set search_path='' as $$select rc_private.trash()$$;

revoke all on function rc_private.can_upload_attachment(text),rc_private.register_attachment(text,uuid,text,text),public.rc_register_attachment(text,uuid,text,text),rc_private.set_deleted(text,uuid,integer,boolean),public.rc_set_deleted(text,uuid,integer,boolean),rc_private.trash(),public.rc_trash() from public,anon,authenticated;
grant execute on function rc_private.can_upload_attachment(text),rc_private.register_attachment(text,uuid,text,text),public.rc_register_attachment(text,uuid,text,text),rc_private.set_deleted(text,uuid,integer,boolean),public.rc_set_deleted(text,uuid,integer,boolean),rc_private.trash(),public.rc_trash() to authenticated;

-- Active-record functions are replaced below; privileges remain unchanged.

create or replace function rc_private.save_record(p_kind text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.rc_members; old jsonb; result jsonb; target uuid; tbl text; v integer;
 d public.rc_demands; e public.rc_events; r public.rc_referrals; person public.rc_members;
begin
 -- Serializing writes also closes concurrent appointment-overlap and access-edit races.
 -- Intended for one municipal team. Revisit lock granularity if usage grows materially.
 perform pg_advisory_xact_lock(hashtextextended('rc_workspace_writes',0));
 m:=rc_private.require_member();
 if m.role='Consulta' then raise exception 'Seu perfil permite apenas consulta.' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>30000 then raise exception 'Registro inválido ou muito extenso.' using errcode='22023'; end if;
 if p_kind='member' and m.role<>'Coordenação' then raise exception 'Somente a coordenação gerencia acessos.' using errcode='42501'; end if;
 if p_kind='note' then
   if not rc_private.record_available('demand',(p_data->>'id')::uuid) then raise exception 'Demanda não encontrada.'; end if;
   if coalesce(char_length(btrim(p_data->>'note')),0) not between 1 and 2000 then raise exception 'Informe um acompanhamento de até 2.000 caracteres.'; end if;
   perform rc_private.audit(m,p_data->>'id','Acompanhamento registrado',null,null,btrim(p_data->>'note'));
   return jsonb_build_object('ok',true);
 end if;
 tbl:=case p_kind when 'demand' then 'rc_demands' when 'event' then 'rc_events' when 'referral' then 'rc_referrals' when 'member' then 'rc_members' end;
 if tbl is null then raise exception 'Operação inválida.' using errcode='22023'; end if;
 target:=nullif(p_data->>'id','')::uuid;
 if target is not null then
   execute format('select to_jsonb(x) from public.%I x where id=$1 for update',tbl) into old using target;
   if old is null then raise exception 'Registro não encontrado.'; end if;
   if p_kind<>'member' and not rc_private.record_available(p_kind,target) then raise exception 'Registro excluído. Recupere-o pela lixeira antes de editar.'; end if;
   if (p_data->>'version')::integer is distinct from (old->>'version')::integer then
     raise exception 'Este registro foi atualizado por outra pessoa. Feche o formulário, atualize a lista e revise antes de salvar.' using errcode='40001';
   end if;
 else target:=gen_random_uuid(); end if;
 v:=coalesce((old->>'version')::integer,0)+1;
 p_data:=p_data||jsonb_build_object('id',target,'version',v);
 if p_kind in ('demand','event') and not exists(select 1 from public.rc_members where id=(p_data->>'ownerId')::uuid and active=1) then
   raise exception 'Escolha um responsável ativo.';
 end if;
 if p_kind='demand' then
   p_data:=p_data||jsonb_build_object('code',coalesce(old->>'code','RC-'||lpad(nextval('public.rc_demand_code_seq')::text,6,'0')),
    'createdAt',coalesce((old->>'createdAt')::timestamptz,now()),'updatedAt',now(),
    'closedAt',case when p_data->>'status'='Concluída' then coalesce((old->>'closedAt')::timestamptz,now()) else null end);
   p_data:=p_data||jsonb_build_object('address',coalesce(p_data->>'address',old->>'address',''),'mapsUrl',coalesce(p_data->>'mapsUrl',old->>'mapsUrl',''));
   d:=jsonb_populate_record(null::public.rc_demands,p_data);
   insert into public.rc_demands select d.* on conflict(id) do update set
    title=excluded.title,neighborhood=excluded.neighborhood,description=excluded.description,priority=excluded.priority,address=excluded.address,"mapsUrl"=excluded."mapsUrl",
    "ownerId"=excluded."ownerId",due=excluded.due,status=excluded.status,"nextStep"=excluded."nextStep",
    "updatedAt"=excluded."updatedAt","closedAt"=excluded."closedAt",version=excluded.version returning to_jsonb(rc_demands.*) into result;
 elsif p_kind='event' then
   e:=jsonb_populate_record(null::public.rc_events,p_data);
   if e.status<>'Cancelado' and exists(select 1 from public.rc_events x where x.id<>target and rc_private.record_available('event',x.id) and x.status<>'Cancelado'
     and x."ownerId"=e."ownerId" and x.date=e.date and x.time<e."endTime" and x."endTime">e.time) then
     raise exception 'Este responsável já tem um compromisso nesse horário. Ajuste o horário ou o responsável.' using errcode='23P01';
   end if;
   insert into public.rc_events select e.* on conflict(id) do update set title=excluded.title,date=excluded.date,
     time=excluded.time,"endTime"=excluded."endTime",location=excluded.location,kind=excluded.kind,"ownerId"=excluded."ownerId",
     notes=excluded.notes,status=excluded.status,version=excluded.version returning to_jsonb(rc_events.*) into result;
 elsif p_kind='referral' then
   if not rc_private.record_available('demand',(p_data->>'demandId')::uuid) then raise exception 'Demanda indisponível ou excluída.'; end if;
   if old is not null and (old->>'demandId') is distinct from (p_data->>'demandId') then raise exception 'A demanda de um encaminhamento não pode ser trocada.'; end if;
   r:=jsonb_populate_record(null::public.rc_referrals,p_data);
   insert into public.rc_referrals select r.* on conflict(id) do update set department=excluded.department,due=excluded.due,
     "sentAt"=excluded."sentAt",status=excluded.status,response=excluded.response,version=excluded.version returning to_jsonb(rc_referrals.*) into result;
 else
   if coalesce((old->>'sample')::integer,0)=1 then raise exception 'Perfis de exemplo não recebem acesso.'; end if;
   p_data:=p_data||jsonb_build_object('authId',old->'authId','sample',0,'email',lower(btrim(p_data->>'email')),
     'active',case when p_data->>'active' in ('true','1') then 1 else 0 end,'jobTitle',coalesce(p_data->>'jobTitle',''));
   person:=jsonb_populate_record(null::public.rc_members,p_data);
   if target=m.id and (person.active<>1 or person.role<>'Coordenação' or person.email<>m.email) then
     raise exception 'Mantenha seu próprio acesso de coordenação ativo e seu e-mail de entrada.';
   end if;
   if old->>'authId' is not null and person.email is distinct from old->>'email' then raise exception 'O e-mail de uma conta vinculada não pode ser alterado.'; end if;
   insert into public.rc_members select person.* on conflict(id) do update set name=excluded.name,email=excluded.email,
     "jobTitle"=excluded."jobTitle",role=excluded.role,active=excluded.active,version=excluded.version returning to_jsonb(rc_members.*) into result;
 end if;
 perform rc_private.audit(m,case when p_kind='referral' then result->>'demandId' else target::text end,
  case when p_kind='member' then case when old is null then 'Pessoa cadastrada' else 'Acesso atualizado' end
       when p_kind='referral' then 'Encaminhamento registrado' when old is null then 'Registro criado' else 'Registro atualizado' end,
  old,result);
 return result;
end $$;
create or replace function rc_private.workspace() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=rc_private.assert_identity(); m public.rc_members; claimed public.rc_members;
begin
 -- Only a preapproved email can be linked. This never creates an administrator.
 perform pg_advisory_xact_lock(hashtextextended('rc_workspace_writes',0));
 update public.rc_members set "authId"=u,version=version+1
 where "authId" is null and active=1 and sample=0
 and email=(select lower(email) from auth.users where id=u)
 returning * into claimed;
 m:=rc_private.require_member();
 if claimed.id is not null then perform rc_private.audit(m,m.id::text,'Conta vinculada',null,to_jsonb(m)); end if;
 return jsonb_build_object(
 'me',to_jsonb(m),'today',(now() at time zone 'America/Sao_Paulo')::date,
 'members',(select coalesce(jsonb_agg(case when m.role='Coordenação' or x.id=m.id then to_jsonb(x) else to_jsonb(x)-'email'-'authId' end order by x.name),'[]'::jsonb) from public.rc_members x),
 'demands',(select coalesce(jsonb_agg(to_jsonb(x) order by x."updatedAt" desc),'[]'::jsonb) from public.rc_demands x where rc_private.record_available('demand',x.id)),
 'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.date,x.time),'[]'::jsonb) from public.rc_events x where rc_private.record_available('event',x.id)),
 'referrals',(select coalesce(jsonb_agg(to_jsonb(x) order by x.due),'[]'::jsonb) from public.rc_referrals x where rc_private.record_available('referral',x.id)));
end $$;


create or replace function rc_private.history(p_entity uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.rc_members:=rc_private.require_member();
begin
 if p_entity is null and m.role<>'Coordenação' then raise exception 'Somente a coordenação consulta a auditoria geral.' using errcode='42501'; end if;
 if p_entity is not null and not rc_private.record_available('demand',p_entity) then raise exception 'Demanda não encontrada.'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc),'[]'::jsonb) from
   (select * from public.rc_audit where p_entity is null or "entityId"=p_entity::text order by at desc limit 250) x);
end $$;

create or replace function rc_private.can_upload_demand_photo(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if rc_private.current_role() is distinct from 'Coordenação' then return false; end if;
 if p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' then return false; end if;
 return rc_private.record_available('demand',split_part(p_path,'/',1)::uuid)
  and (select count(*) from public.rc_demand_photos where "demandId"=split_part(p_path,'/',1)::uuid)<20;
end $$;

notify pgrst,'reload schema';
commit;
