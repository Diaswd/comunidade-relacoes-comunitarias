begin;
create function rc_private.pending_accounts() returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.rc_members:=rc_private.require_member();
begin
 if m.role<>'Coordenação' then raise exception 'Somente a coordenação cria acessos.' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'version',p.version,
  'existingAuthId',(select u.id from auth.users u where lower(u.email)=p.email),'role',p.role) order by p.name),'[]'::jsonb)
  from public.rc_members p where p.active=1 and p.sample=0 and p."authId" is null and p.id<>m.id);
end $$;

create function rc_private.link_member_login(p_member uuid,p_auth uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare m public.rc_members; target public.rc_members; old jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('rc_workspace_writes',0));
 m:=rc_private.require_member();
 if m.role<>'Coordenação' then raise exception 'Somente a coordenação cria acessos.' using errcode='42501'; end if;
 select * into target from public.rc_members where id=p_member for update;
 if target.id is null or target.id=m.id or target.active<>1 or target.sample<>0 or target."authId" is not null
  or target.version is distinct from p_version then
  raise exception 'O cadastro mudou. Atualize a equipe antes de criar o acesso.' using errcode='40001';
 end if;
 if not exists(select 1 from auth.users u where u.id=p_auth and lower(u.email)=target.email
  and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())) then
  raise exception 'A conta de login precisa estar ativa e usar o e-mail cadastrado.' using errcode='42501';
 end if;
 old:=to_jsonb(target);
 update public.rc_members set "authId"=p_auth,version=version+1 where id=p_member returning * into target;
 perform rc_private.audit(m,p_member::text,'Acesso de login ativado',old,to_jsonb(target),'Senha e credenciais não são registradas na auditoria.');
end $$;
create function public.rc_pending_accounts() returns jsonb
language sql security invoker set search_path='' as $$select rc_private.pending_accounts()$$;
create function public.rc_link_member_login(p_member uuid,p_auth uuid,p_version integer) returns void
language sql security invoker set search_path='' as $$select rc_private.link_member_login(p_member,p_auth,p_version)$$;
revoke all on function rc_private.pending_accounts(),rc_private.link_member_login(uuid,uuid,integer),public.rc_pending_accounts(),public.rc_link_member_login(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function rc_private.pending_accounts(),rc_private.link_member_login(uuid,uuid,integer),public.rc_pending_accounts(),public.rc_link_member_login(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
