begin;
alter table public.rc_demands add column address text not null default '' check(char_length(address)<=500);
alter table public.rc_demands add column "mapsUrl" text not null default '' check(char_length("mapsUrl")<=2048 and ("mapsUrl"='' or "mapsUrl" ~ '^https://((www\.)?google\.com(\.br)?/maps([/?#][^[:space:]]*)?|maps\.google\.com(\.br)?/[^[:space:]]*|maps\.app\.goo\.gl/[A-Za-z0-9]+([?#][^[:space:]]*)?|goo\.gl/maps/[A-Za-z0-9]+([?#][^[:space:]]*)?)$'));
update rc_private.demo_records set baseline=baseline||jsonb_build_object('address','','mapsUrl','') where kind='demand';

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
   if not exists(select 1 from public.rc_demands where id=(p_data->>'id')::uuid) then raise exception 'Demanda não encontrada.'; end if;
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
   if e.status<>'Cancelado' and exists(select 1 from public.rc_events x where x.id<>target and x.status<>'Cancelado'
     and x."ownerId"=e."ownerId" and x.date=e.date and x.time<e."endTime" and x."endTime">e.time) then
     raise exception 'Este responsável já tem um compromisso nesse horário. Ajuste o horário ou o responsável.' using errcode='23P01';
   end if;
   insert into public.rc_events select e.* on conflict(id) do update set title=excluded.title,date=excluded.date,
     time=excluded.time,"endTime"=excluded."endTime",location=excluded.location,kind=excluded.kind,"ownerId"=excluded."ownerId",
     notes=excluded.notes,status=excluded.status,version=excluded.version returning to_jsonb(rc_events.*) into result;
 elsif p_kind='referral' then
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


create table public.rc_demand_photos (
 id uuid primary key default gen_random_uuid(),
 "demandId" uuid not null references public.rc_demands(id) on delete restrict,
 path text not null unique,
 name text not null check(char_length(name) between 1 and 180),
 "uploadedBy" uuid not null references public.rc_members(id),
 "createdAt" timestamptz not null default now(),
 size integer not null check(size between 1 and 5242880)
);
create index rc_demand_photos_demand_idx on public.rc_demand_photos("demandId","createdAt");
create index rc_demand_photos_uploader_idx on public.rc_demand_photos("uploadedBy");
alter table public.rc_demand_photos enable row level security;
revoke all on public.rc_demand_photos from public,anon,authenticated;
grant select on public.rc_demand_photos to authenticated;
create policy team_photo_read on public.rc_demand_photos for select to authenticated using((select rc_private.current_role()) is not null);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('rc-demand-photos','rc-demand-photos',false,5242880,array['image/jpeg']);

create function rc_private.can_upload_demand_photo(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if rc_private.current_role() is distinct from 'Coordenação' then return false; end if;
 if p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' then return false; end if;
 return exists(select 1 from public.rc_demands where id=split_part(p_path,'/',1)::uuid)
  and (select count(*) from public.rc_demand_photos where "demandId"=split_part(p_path,'/',1)::uuid)<20;
end $$;
create policy rc_photo_upload on storage.objects for insert to authenticated
 with check(bucket_id='rc-demand-photos' and rc_private.can_upload_demand_photo(name));
create policy rc_photo_download on storage.objects for select to authenticated
 using(bucket_id='rc-demand-photos' and (select rc_private.current_role()) is not null
 and exists(select 1 from public.rc_demand_photos p where p.path=storage.objects.name));

create function rc_private.register_demand_photo(p_demand uuid,p_path text,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.rc_members; photo public.rc_demand_photos; obj storage.objects; bytes bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('rc_workspace_writes',0));
 m:=rc_private.require_member();
 if m.role<>'Coordenação' then raise exception 'Somente a coordenação pode adicionar fotos.' using errcode='42501'; end if;
 if p_path is null or p_demand is null or split_part(p_path,'/',1)<>p_demand::text then raise exception 'Foto não pertence à demanda.'; end if;
 select * into photo from public.rc_demand_photos where path=p_path;
 if photo.id is not null then
  if photo."uploadedBy"<>m.id or photo."demandId"<>p_demand then raise exception 'Foto de outro envio.' using errcode='42501'; end if;
  return to_jsonb(photo);
 end if;
 if not rc_private.can_upload_demand_photo(p_path) then raise exception 'Demanda inválida ou limite de 20 fotos atingido.'; end if;
 select * into obj from storage.objects where bucket_id='rc-demand-photos' and name=p_path and owner_id=m."authId"::text;
 if obj.id is null then raise exception 'Conclua o envio da foto antes de registrá-la.'; end if;
 bytes:=(obj.metadata->>'size')::bigint;
 if obj.metadata->>'mimetype' is distinct from 'image/jpeg' or bytes is null or bytes not between 1 and 5242880 then raise exception 'Formato ou tamanho de foto inválido.'; end if;
 insert into public.rc_demand_photos("demandId",path,name,"uploadedBy",size)
 values(p_demand,p_path,btrim(p_name),m.id,bytes) returning * into photo;
 perform rc_private.audit(m,p_demand::text,'Foto adicionada',null,to_jsonb(photo),photo.name);
 return to_jsonb(photo);
end $$;
create function public.rc_register_demand_photo(p_demand uuid,p_path text,p_name text) returns jsonb
language sql security invoker set search_path='' as $$select rc_private.register_demand_photo(p_demand,p_path,p_name)$$;
revoke all on function rc_private.can_upload_demand_photo(text),rc_private.register_demand_photo(uuid,text,text),public.rc_register_demand_photo(uuid,text,text) from public,anon,authenticated;
grant execute on function rc_private.can_upload_demand_photo(text),rc_private.register_demand_photo(uuid,text,text),public.rc_register_demand_photo(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
