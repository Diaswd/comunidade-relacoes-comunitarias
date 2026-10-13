-- Comunidade: one authorized team, shared operational records.
-- No anonymous data access. No browser service key. No first-user admin claim.
begin;
create schema rc_private;
revoke all on schema rc_private from public, anon, authenticated;
grant usage on schema rc_private to authenticated;

create table public.rc_members (
 id uuid primary key default gen_random_uuid(),
 "authId" uuid unique references auth.users(id) on delete set null,
 name text not null check (char_length(btrim(name)) between 1 and 180),
 email text not null unique check (email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and char_length(email)<=180),
 "jobTitle" text not null default '' check (char_length("jobTitle")<=180),
 role text not null check (role in ('Coordenação','Equipe','Consulta')),
 active integer not null default 1 check (active in (0,1)),
 sample integer not null default 0 check (sample in (0,1)),
 version integer not null default 1 check (version>0)
);
create sequence public.rc_demand_code_seq;
create table public.rc_demands (
 id uuid primary key default gen_random_uuid(),
 code text not null unique,
 title text not null check (char_length(btrim(title)) between 1 and 180),
 neighborhood text not null check (char_length(btrim(neighborhood)) between 1 and 180),
 description text not null check (char_length(btrim(description)) between 1 and 4000),
 priority text not null check (priority in ('Baixa','Normal','Alta','Urgente')),
 "ownerId" uuid not null references public.rc_members(id),
 due date not null check (due between '2000-01-01' and '2100-12-31'),
 status text not null check (status in ('Nova','Em triagem','Em andamento','Aguardando retorno','Concluída')),
 "nextStep" text not null default '' check (char_length("nextStep")<=1200),
 "createdAt" timestamptz not null default now(),
 "updatedAt" timestamptz not null default now(),
 "closedAt" timestamptz,
 version integer not null default 1 check (version>0),
 check ((status='Concluída')=("closedAt" is not null))
);
create table public.rc_events (
 id uuid primary key default gen_random_uuid(),
 title text not null check (char_length(btrim(title)) between 1 and 180),
 date date not null check (date between '2000-01-01' and '2100-12-31'),
 time text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 "endTime" text not null check ("endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 location text not null check (char_length(btrim(location)) between 1 and 180),
 kind text not null check (kind in ('Reunião interna','Reunião comunitária','Visita')),
 "ownerId" uuid not null references public.rc_members(id),
 notes text not null default '' check (char_length(notes)<=2000),
 status text not null check (status in ('Agendado','Realizado','Cancelado')),
 version integer not null default 1 check (version>0),
 check ("endTime">time)
);
create table public.rc_referrals (
 id uuid primary key default gen_random_uuid(),
 "demandId" uuid not null references public.rc_demands(id),
 department text not null check (char_length(btrim(department)) between 1 and 180),
 due date not null check (due between '2000-01-01' and '2100-12-31'),
 "sentAt" date not null check ("sentAt" between '2000-01-01' and '2100-12-31'),
 status text not null check (status in ('Aguardando retorno','Em atendimento','Respondido')),
 response text not null default '' check (char_length(response)<=3000),
 version integer not null default 1 check (version>0),
 check (due >= "sentAt"),
 check (status<>'Respondido' or char_length(btrim(response))>0)
);
create table public.rc_audit (
 id uuid primary key default gen_random_uuid(),
 "entityId" text not null,
 "actorId" uuid references public.rc_members(id),
 actor text not null,
 action text not null,
 "before" jsonb,
 "after" jsonb,
 note text not null default '',
 at timestamptz not null default now()
);
create index rc_demands_owner_idx on public.rc_demands("ownerId");
create index rc_demands_open_due_idx on public.rc_demands(due) where status<>'Concluída';
create index rc_events_schedule_idx on public.rc_events("ownerId", date);
create index rc_referrals_demand_idx on public.rc_referrals("demandId");
create index rc_referrals_pending_idx on public.rc_referrals(due) where status<>'Respondido';
create index rc_audit_entity_time_idx on public.rc_audit("entityId",at desc);
create index rc_audit_time_idx on public.rc_audit(at desc);
create index rc_audit_actor_idx on public.rc_audit("actorId");

-- Privileged helpers are confined to an unexposed schema, with fixed search_path.
-- Every API entry verifies a real, confirmed Auth user and a live Auth session.
create function rc_private.assert_identity() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); s uuid:=(auth.jwt()->>'session_id')::uuid;
begin
 if u is null or s is null or not exists (
   select 1 from auth.users where id=u and email_confirmed_at is not null
   and coalesce(is_anonymous,false)=false and (banned_until is null or banned_until<=now())
 ) or not exists (select 1 from auth.sessions where id=s and user_id=u) then
   raise exception 'Entre novamente com uma conta confirmada.' using errcode='42501';
 end if;
 return u;
end $$;
create function rc_private.current_role() returns text
language plpgsql stable security definer set search_path='' as $$
declare u uuid;
begin
 u:=rc_private.assert_identity();
 return (select role from public.rc_members where "authId"=u and active=1 and sample=0);
exception when insufficient_privilege then return null;
end $$;
create function rc_private.require_member() returns public.rc_members
language plpgsql security definer set search_path='' as $$
declare u uuid:=rc_private.assert_identity(); m public.rc_members;
begin
 select * into m from public.rc_members where "authId"=u and active=1 and sample=0;
 if m.id is null then raise exception 'Seu acesso ainda não foi liberado ou está inativo. Procure a coordenação.' using errcode='42501'; end if;
 return m;
end $$;
create function rc_private.audit(m public.rc_members,e text,a text,b jsonb,n jsonb,nt text default '') returns void
language sql set search_path='' as $$
 insert into public.rc_audit("entityId","actorId",actor,action,"before","after",note)
 values(e,m.id,m.name,a,b,n,nt);
$$;
create function rc_private.workspace() returns jsonb
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
 'demands',(select coalesce(jsonb_agg(to_jsonb(x) order by x."updatedAt" desc),'[]'::jsonb) from public.rc_demands x),
 'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.date,x.time),'[]'::jsonb) from public.rc_events x),
 'referrals',(select coalesce(jsonb_agg(to_jsonb(x) order by x.due),'[]'::jsonb) from public.rc_referrals x));
end $$;

create function rc_private.save_record(p_kind text,p_data jsonb) returns jsonb
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
   d:=jsonb_populate_record(null::public.rc_demands,p_data);
   insert into public.rc_demands select d.* on conflict(id) do update set
    title=excluded.title,neighborhood=excluded.neighborhood,description=excluded.description,priority=excluded.priority,
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
create function rc_private.history(p_entity uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.rc_members:=rc_private.require_member();
begin
 if p_entity is null and m.role<>'Coordenação' then raise exception 'Somente a coordenação consulta a auditoria geral.' using errcode='42501'; end if;
 if p_entity is not null and not exists(select 1 from public.rc_demands where id=p_entity) then raise exception 'Demanda não encontrada.'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc),'[]'::jsonb) from
   (select * from public.rc_audit where p_entity is null or "entityId"=p_entity::text order by at desc limit 250) x);
end $$;
create function rc_private.log_export(p_filters jsonb,p_count integer,p_week date) returns void
language plpgsql security definer set search_path='' as $$
declare m public.rc_members:=rc_private.require_member();
begin
 if p_filters is null or jsonb_typeof(p_filters)<>'object' or octet_length(p_filters::text)>4000 or p_count is null or p_count<0 or p_week is null then raise exception 'Parâmetros de exportação inválidos.'; end if;
 perform rc_private.audit(m,'export','Exportação Excel preparada',null,jsonb_build_object('filters',p_filters,'count',p_count,'week',p_week));
end $$;

-- These public API wrappers are invokers. All privileged implementations live in rc_private.
create function public.rc_workspace() returns jsonb language sql security invoker set search_path='' as $$select rc_private.workspace()$$;
create function public.rc_save_record(p_kind text,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select rc_private.save_record(p_kind,p_data)$$;
create function public.rc_history(p_entity uuid default null) returns jsonb language sql security invoker set search_path='' as $$select rc_private.history(p_entity)$$;
create function public.rc_log_export(p_filters jsonb,p_count integer,p_week date) returns void language sql security invoker set search_path='' as $$select rc_private.log_export(p_filters,p_count,p_week)$$;

alter table public.rc_members enable row level security;
alter table public.rc_demands enable row level security;
alter table public.rc_events enable row level security;
alter table public.rc_referrals enable row level security;
alter table public.rc_audit enable row level security;
create policy member_read on public.rc_members for select to authenticated
 using ((select rc_private.current_role()) is not null and ("authId"=(select auth.uid()) or (select rc_private.current_role())='Coordenação'));
create policy team_read on public.rc_demands for select to authenticated using ((select rc_private.current_role()) is not null);
create policy team_read on public.rc_events for select to authenticated using ((select rc_private.current_role()) is not null);
create policy team_read on public.rc_referrals for select to authenticated using ((select rc_private.current_role()) is not null);
create policy audit_read on public.rc_audit for select to authenticated using ((select rc_private.current_role())='Coordenação');

-- Direct writes are denied to every client. RPC writes and audit commit together.
revoke all on public.rc_members,public.rc_demands,public.rc_events,public.rc_referrals,public.rc_audit from public,anon,authenticated;
revoke all on sequence public.rc_demand_code_seq from public,anon,authenticated;
grant select on public.rc_members,public.rc_demands,public.rc_events,public.rc_referrals,public.rc_audit to authenticated;
revoke all on all functions in schema rc_private from public,anon,authenticated;
grant execute on function rc_private.current_role(),rc_private.workspace(),rc_private.save_record(text,jsonb),rc_private.history(uuid),rc_private.log_export(jsonb,integer,date) to authenticated;
revoke all on function public.rc_workspace(),public.rc_save_record(text,jsonb),public.rc_history(uuid),public.rc_log_export(jsonb,integer,date) from public,anon,authenticated;
grant execute on function public.rc_workspace(),public.rc_save_record(text,jsonb),public.rc_history(uuid),public.rc_log_export(jsonb,integer,date) to authenticated;
comment on schema rc_private is 'Internal authorization-checked RPC implementations. Do not expose via PostgREST.';
notify pgrst,'reload schema';
commit;
