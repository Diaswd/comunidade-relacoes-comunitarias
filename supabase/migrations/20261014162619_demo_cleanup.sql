begin;

-- An administrator registers only known imported examples, with their original contents.
-- The application cannot add records to this manifest or change its snapshots.
create table rc_private.demo_records (
 kind text not null check (kind in ('demand','event','referral','member')),
 id uuid not null,
 baseline jsonb not null check (jsonb_typeof(baseline)='object'),
 primary key(kind,id)
);
alter table rc_private.demo_records enable row level security;
revoke all on rc_private.demo_records from public,anon,authenticated;

create function rc_private.demo_cleanup(p_confirm boolean default false,p_expected text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 m public.rc_members;
 ds uuid[]; es uuid[]; rs uuid[]; ms uuid[];
 total integer; registered integer; snapshot jsonb; result jsonb; token text;
 item record;
begin
 perform pg_advisory_xact_lock(hashtextextended('rc_workspace_writes',0));
 m:=rc_private.require_member();
 if m.role<>'Coordenação' then
  raise exception 'Somente a coordenação pode excluir demonstrações.' using errcode='42501';
 end if;

 -- Preserve a demand and its referrals if anyone edited it, added a note, or
 -- attached a referral that is not an unchanged imported example.
 select coalesce(array_agg(d.id order by d.id),'{}'::uuid[]) into ds
 from public.rc_demands d join rc_private.demo_records b on b.kind='demand' and b.id=d.id
 where to_jsonb(d)=b.baseline
 and not exists(select 1 from public.rc_audit a where a."entityId"=d.id::text and a."actorId" is not null)
 and not exists(
  select 1 from public.rc_referrals r where r."demandId"=d.id
  and not exists(select 1 from rc_private.demo_records rb where rb.kind='referral' and rb.id=r.id and rb.baseline=to_jsonb(r))
 );
 select coalesce(array_agg(r.id order by r.id),'{}'::uuid[]) into rs
 from public.rc_referrals r join rc_private.demo_records b on b.kind='referral' and b.id=r.id
 where to_jsonb(r)=b.baseline and r."demandId"=any(ds);
 select coalesce(array_agg(e.id order by e.id),'{}'::uuid[]) into es
 from public.rc_events e join rc_private.demo_records b on b.kind='event' and b.id=e.id
 where to_jsonb(e)=b.baseline
 and not exists(select 1 from public.rc_audit a where a."entityId"=e.id::text and a."actorId" is not null);

 -- Never remove an Auth identity or a member used by retained work/audit.
 select coalesce(array_agg(u.id order by u.id),'{}'::uuid[]) into ms
 from public.rc_members u join rc_private.demo_records b on b.kind='member' and b.id=u.id
 where to_jsonb(u)=b.baseline and u.sample=1 and u."authId" is null and u.id<>m.id
 and not exists(select 1 from public.rc_demands d where d."ownerId"=u.id and not(d.id=any(ds)))
 and not exists(select 1 from public.rc_events e where e."ownerId"=u.id and not(e.id=any(es)))
 and not exists(select 1 from public.rc_audit a where a."actorId"=u.id);

 select count(*) into registered from rc_private.demo_records b where
  (b.kind='demand' and exists(select 1 from public.rc_demands d where d.id=b.id)) or
  (b.kind='event' and exists(select 1 from public.rc_events e where e.id=b.id)) or
  (b.kind='referral' and exists(select 1 from public.rc_referrals r where r.id=b.id)) or
  (b.kind='member' and exists(select 1 from public.rc_members u where u.id=b.id));
 total:=cardinality(ds)+cardinality(es)+cardinality(rs)+cardinality(ms);
 snapshot:=jsonb_build_object('demands',ds,'events',es,'referrals',rs,'members',ms,'registered',registered);
 token:=md5(snapshot::text);
 result:=jsonb_build_object('demands',cardinality(ds),'events',cardinality(es),'referrals',cardinality(rs),
  'members',cardinality(ms),'total',total,'preserved',registered-total,'token',token,'deleted',false);
 if p_confirm is distinct from true then return result; end if;
 if p_expected is distinct from token then
  raise exception 'A lista mudou. Revise novamente as demonstrações antes de excluir.' using errcode='40001';
 end if;
 if total=0 then return result; end if;

 for item in select id,to_jsonb(r) as data from public.rc_referrals r where id=any(rs) loop
  perform rc_private.audit(m,item.id::text,'Demonstração excluída',item.data,null,'Encaminhamento de demonstração');
 end loop;
 delete from public.rc_referrals where id=any(rs);
 for item in select id,to_jsonb(d) as data from public.rc_demands d where id=any(ds) loop
  perform rc_private.audit(m,item.id::text,'Demonstração excluída',item.data,null,'Demanda de demonstração');
 end loop;
 delete from public.rc_demands where id=any(ds);
 for item in select id,to_jsonb(e) as data from public.rc_events e where id=any(es) loop
  perform rc_private.audit(m,item.id::text,'Demonstração excluída',item.data,null,'Compromisso de demonstração');
 end loop;
 delete from public.rc_events where id=any(es);
 for item in select id,to_jsonb(u) as data from public.rc_members u where id=any(ms) loop
  perform rc_private.audit(m,item.id::text,'Demonstração excluída',item.data,null,'Perfil fictício sem login');
 end loop;
 delete from public.rc_members where id=any(ms);
 delete from rc_private.demo_records where
  (kind='demand' and id=any(ds)) or (kind='event' and id=any(es)) or
  (kind='referral' and id=any(rs)) or (kind='member' and id=any(ms));
 result:=result||jsonb_build_object('deleted',true);
 perform rc_private.audit(m,'demo-cleanup','Demonstrações excluídas',null,result-'token',
  'Somente exemplos importados sem alterações. Auditoria e contas reais preservadas.');
 return result;
end $$;

create function public.rc_demo_cleanup(p_confirm boolean default false,p_expected text default null)
returns jsonb language sql security invoker set search_path='' as $$select rc_private.demo_cleanup(p_confirm,p_expected)$$;
revoke all on function rc_private.demo_cleanup(boolean,text),public.rc_demo_cleanup(boolean,text) from public,anon,authenticated;
grant execute on function rc_private.demo_cleanup(boolean,text),public.rc_demo_cleanup(boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
