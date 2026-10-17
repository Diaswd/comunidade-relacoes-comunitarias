import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Postgres: authorization, mutations, audit and optimistic conflicts',async t=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;
 create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'$$;
 ` .replace("select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'","select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid"));
 await db.exec(`create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
 grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
 await db.exec(`create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to authenticated;grant select on storage.objects to anon;`);
 const folder=new URL('../supabase/migrations/',import.meta.url);
 for(const file of (await readdir(folder)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,folder),'utf8'));
 const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const admin=uid(1),editor=uid(2),reader=uid(3),outsider=uid(4),unverified=uid(5),otherAdmin=uid(6);
 for(const [id,email,role] of [[admin,'admin@example.test','Coordenação'],[editor,'editor@example.test','Equipe'],[reader,'reader@example.test','Consulta'],[outsider,'outsider@example.test',null],[unverified,'unverified@example.test','Coordenação'],[otherAdmin,'admin2@example.test','Coordenação']]){
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[id,email,id===unverified?null:new Date().toISOString()]);
  await db.query('insert into auth.sessions values($1,$2)',[uid(Number(id.slice(-2))+100),id]);
  if(role)await db.query('insert into public.rc_members(id,name,email,role) values($1,$2,$3,$4)',[id,'Pessoa '+id.slice(-1),email,role]);
 }
 async function as(id,sql,params=[]){
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(id?{sub:id,session_id:uid(Number(id.slice(-2))+100)}:{})]);
  await db.exec(id?'set role authenticated':'set role anon');
  try{return await db.query(sql,params)}finally{await db.exec('reset role')}
 }
 const rpc=async(id,name,args=[],placeholder=args.map((_,i)=>'$'+(i+1)).join(','))=>(await as(id,`select public.${name}(${placeholder}) as value`,args)).rows[0].value;
 const save=(id,kind,data)=>rpc(id,'rc_save_record',[kind,JSON.stringify(data)]);
 const demand={title:'Praça de teste',neighborhood:'Centro',description:'Registro fictício',priority:'Normal',ownerId:editor,due:'2026-10-20',status:'Nova',nextStep:'Revisar prazo'};
 let first,event,ref,editorMember;
 await t.test('anonymous cannot call workspace or read records',async()=>{
  await assert.rejects(rpc(null,'rc_workspace'),/permission denied/);
  await assert.rejects(as(null,'select * from public.rc_demands'),/permission denied/);
 });
 await t.test('unapproved and unverified accounts cannot bootstrap access',async()=>{
  await assert.rejects(rpc(outsider,'rc_workspace'),/não foi liberado/);
  await assert.rejects(rpc(unverified,'rc_workspace'),/conta confirmada/);
 });
 await t.test('approved email links verified identity once',async()=>{
  const a=await rpc(admin,'rc_workspace');assert.equal(a.me.authId,admin);assert.equal(a.me.role,'Coordenação');
  await rpc(editor,'rc_workspace');await rpc(reader,'rc_workspace');await rpc(otherAdmin,'rc_workspace');
  editorMember=(await rpc(editor,'rc_workspace')).me;
  const logs=await rpc(admin,'rc_history');assert.equal(logs.filter(x=>x.action==='Conta vinculada'&&x.entityId===admin).length,1);
 });
 await t.test('team creates demand and author/time are server controlled',async()=>{
  first=await save(editor,'demand',{...demand,createdAt:'2000-01-01',code:'FORGED',version:99});
  assert.equal(first.version,1);assert.match(first.code,/^RC-/);assert.notEqual(first.createdAt,'2000-01-01');
  const logs=await rpc(reader,'rc_history',[first.id]);assert.equal(logs.length,1);assert.equal(logs[0].actorId,editor);assert.ok(logs[0].at);
 });
 await t.test('address and Maps are saved and audited; old clients preserve them',async()=>{
  first=await save(editor,'demand',{...first,address:'Rua de teste, 120',mapsUrl:'https://maps.app.goo.gl/Example123'});
  assert.equal(first.address,'Rua de teste, 120');
  const {address,mapsUrl,...oldClient}=first;
  first=await save(editor,'demand',oldClient);assert.equal(first.address,address);assert.equal(first.mapsUrl,mapsUrl);
  for(const url of ['javascript:alert(1)','https://evil.test/maps','https://google.com.evil.test/maps','https://www.google.com/maps.evil','https://www.google.com@evil.test/maps'])await assert.rejects(save(editor,'demand',{...first,mapsUrl:url}),/check constraint/);
  await assert.rejects(save(editor,'demand',{...first,address:'x'.repeat(501)}),/check constraint/);
  assert.ok((await rpc(reader,'rc_history',[first.id])).some(a=>a.after?.address===address));
 });
 await t.test('photos require coordination and registered private objects; registration is audited and idempotent',async()=>{
  const path=first.id+'/'+uid(901)+'.jpg';
  const uploadSql="insert into storage.objects(bucket_id,name,owner_id,metadata) values('rc-demand-photos',$1,$2,$3)";
  const meta=JSON.stringify({size:300,mimetype:'image/jpeg'});
  for(const role of [editor,reader,outsider,unverified])await assert.rejects(as(role,uploadSql,[path,role,meta]),/row-level security/);
  await assert.rejects(as(admin,uploadSql,['../other.jpg',admin,meta]),/row-level security/);
  await as(admin,uploadSql,[path,admin,meta]);
  assert.equal((await as(reader,'select * from storage.objects')).rows.length,0);
  for(const role of [null,editor,reader])await assert.rejects(rpc(role,'rc_register_demand_photo',[first.id,path,'foto.jpg']),/permission denied|coordenação/);
  await assert.rejects(rpc(otherAdmin,'rc_register_demand_photo',[first.id,path,'foto.jpg']),/Conclua o envio/);
  await assert.rejects(rpc(admin,'rc_register_demand_photo',[uid(999),path,'foto.jpg']),/não pertence/);
  const photo=await rpc(admin,'rc_register_demand_photo',[first.id,path,'foto.jpg']);
  assert.equal(photo.uploadedBy,admin);assert.equal(photo.size,300);
  assert.equal((await rpc(admin,'rc_register_demand_photo',[first.id,path,'foto.jpg'])).id,photo.id);
  assert.equal((await rpc(reader,'rc_history',[first.id])).filter(a=>a.action==='Foto adicionada').length,1);
  assert.equal((await as(reader,'select * from storage.objects')).rows.length,1);
  assert.equal((await as(outsider,'select * from storage.objects')).rows.length,0);
  assert.equal((await as(null,'select * from storage.objects')).rows.length,0);
  assert.equal((await as(reader,'select * from public.rc_demand_photos')).rows.length,1);
  await assert.rejects(as(admin,'delete from public.rc_demand_photos'),/permission denied/);
  assert.equal((await as(admin,'delete from storage.objects returning id')).rows.length,0);
  const invalid=first.id+'/'+uid(902)+'.jpg';
  await as(admin,uploadSql,[invalid,admin,JSON.stringify({size:6000000,mimetype:'image/jpeg'})]);
  await assert.rejects(rpc(admin,'rc_register_demand_photo',[first.id,invalid,'large.jpg']),/tamanho/);
 });
 await t.test('reader cannot write through RPC or directly',async()=>{
  await assert.rejects(save(reader,'demand',demand),/apenas consulta/);
  await assert.rejects(as(reader,'update public.rc_demands set title=$1 where id=$2',['Changed',first.id]),/permission denied/);
 });
 await t.test('team cannot manage members, forge authId, or read their emails',async()=>{
  await assert.rejects(save(editor,'member',{name:'X',email:'x@example.test',role:'Coordenação',active:true}),/coordenação/);
  const s=await rpc(editor,'rc_workspace');assert.equal(s.members.find(x=>x.id===admin).email,undefined);assert.equal(s.members.find(x=>x.id===admin).authId,undefined);
  const direct=await as(editor,'select email from public.rc_members');assert.deepEqual(direct.rows.map(x=>x.email),['editor@example.test']);
 });
 await t.test('client cannot tamper with audit or direct record writes',async()=>{
  await assert.rejects(as(editor,'delete from public.rc_audit'),/permission denied/);
  await assert.rejects(as(admin,"insert into public.rc_audit(\"entityId\",actor,action) values('fake','fake','fake')"),/permission denied/);
  await assert.rejects(as(editor,'update public.rc_members set role=$1 where id=$2',['Coordenação',editor]),/permission denied/);
 });
 await t.test('member update preserves auth identity and protects own admin access',async()=>{
  const m=(await rpc(admin,'rc_workspace')).me;
  await assert.rejects(save(admin,'member',{...m,role:'Equipe',active:true}),/próprio acesso/);
  const saved=await save(admin,'member',{...editorMember,authId:admin,active:true,jobTitle:'Agente comunitário'});
  assert.equal(saved.authId,editor);assert.equal(saved.jobTitle,'Agente comunitário');editorMember=saved;
 });
 await t.test('stale updates fail and do not create audit entries',async()=>{
  const next=await save(admin,'demand',{...first,status:'Em andamento'});assert.equal(next.version,first.version+1);
  const before=(await rpc(admin,'rc_history',[first.id])).length;
  await assert.rejects(save(editor,'demand',{...first,title:'stale'}),/atualizado por outra pessoa/);
  assert.equal((await rpc(admin,'rc_history',[first.id])).length,before);first=next;
 });
 await t.test('completion/reopening uses server timestamps',async()=>{
  first=await save(editor,'demand',{...first,status:'Concluída',closedAt:'2001-01-01'});assert.ok(first.closedAt.startsWith('20'));assert.notEqual(first.closedAt,'2001-01-01');
  first=await save(editor,'demand',{...first,status:'Em andamento'});assert.equal(first.closedAt,null);
 });
 await t.test('validation cannot be bypassed by calling RPC directly',async()=>{
  await assert.rejects(save(editor,'demand',{...demand,status:'inventado'}),/check constraint/);
  await assert.rejects(save(editor,'demand',{...demand,due:'2026-02-30'}),/out of range/);
  await assert.rejects(save(editor,'demand',{...demand,title:''}),/check constraint/);
  await assert.rejects(save(editor,'demand',{...demand,ownerId:outsider}),/responsável ativo/);
 });
 await t.test('agenda rejects overlaps and invalid durations',async()=>{
  const data={title:'Visita',date:'2026-10-20',time:'09:00',endTime:'10:00',location:'Centro',kind:'Visita',ownerId:editor,notes:'',status:'Agendado'};
  event=await save(editor,'event',data);
  await assert.rejects(save(editor,'event',{...data,time:'09:30',endTime:'10:30'}),/compromisso nesse horário/);
  await assert.rejects(save(editor,'event',{...data,time:'11:00',endTime:'10:00'}),/check constraint/);
  await save(editor,'event',{...data,time:'10:00',endTime:'11:00'});
  await save(editor,'event',{...data,status:'Cancelado'});
 });
 await t.test('referrals require valid demand, dates and response',async()=>{
  const data={demandId:first.id,department:'Secretaria exemplo',sentAt:'2026-10-13',due:'2026-10-20',status:'Aguardando retorno',response:''};
  ref=await save(editor,'referral',data);
  await assert.rejects(save(editor,'referral',{...ref,status:'Respondido'}),/check constraint/);
  await assert.rejects(save(editor,'referral',{...data,due:'2026-10-12'}),/check constraint/);
  await assert.rejects(save(editor,'referral',{...data,demandId:uid(99)}),/indisponível/);
  await save(editor,'referral',{...ref,status:'Respondido',response:'Retorno fictício'});
  assert.ok((await rpc(reader,'rc_history',[first.id])).some(x=>x.action==='Encaminhamento registrado'));
 });
 await t.test('notes and scoped history, general audit remains coordinator-only',async()=>{
  await save(editor,'note',{id:first.id,note:'Próximo passo definido.'});
  assert.ok((await rpc(reader,'rc_history',[first.id])).some(x=>x.note==='Próximo passo definido.'));
  await assert.rejects(rpc(editor,'rc_history'),/coordenação/);
  assert.equal((await as(editor,'select * from public.rc_audit')).rows.length,0);
  await assert.rejects(rpc(editor,'rc_history',[admin]),/Demanda não encontrada/);
 });
 await t.test('all active roles can log Excel export',async()=>{
  await rpc(reader,'rc_log_export',[JSON.stringify({status:'Todas'}),1,'2026-10-12']);
  const logs=await rpc(admin,'rc_history');assert.ok(logs.some(x=>x.action==='Exportação Excel preparada'&&x.actorId===reader));
 });
 const demoMember=uid(60),demoDemand=uid(61),demoEdited=uid(62),demoNote=uid(63),demoLinked=uid(64),demoReferral=uid(70),demoEvent=uid(80),demoEditedEvent=uid(81);
 let cleanupPreview;
 await t.test('cleanup preview is coordinator-only and does not delete records',async()=>{
  await db.query('insert into public.rc_members(id,name,email,role,sample) values($1,$2,$3,$4,1)',[demoMember,'Exemplo','demo@example.invalid','Equipe']);
  for(const id of [demoDemand,demoEdited,demoNote,demoLinked])await db.query('insert into public.rc_demands(id,code,title,neighborhood,description,priority,"ownerId",due,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,'DEMO-'+id.slice(-2),'Exemplo original','Centro','Fictício','Normal',demoMember,'2026-10-22','Nova']);
  await db.query('insert into public.rc_referrals(id,"demandId",department,due,"sentAt",status) values($1,$2,$3,$4,$5,$6)',[demoReferral,demoDemand,'Área fictícia','2026-10-22','2026-10-14','Aguardando retorno']);
  for(const [id,time,endTime] of [[demoEvent,'08:00','09:00'],[demoEditedEvent,'10:00','11:00']])await db.query('insert into public.rc_events(id,title,date,time,"endTime",location,kind,"ownerId",status) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,'Agenda fictícia','2026-10-22',time,endTime,'Centro','Visita',demoMember,'Agendado']);
  for(const [kind,table,ids] of [['member','rc_members',[demoMember]],['demand','rc_demands',[demoDemand,demoEdited,demoNote,demoLinked]],['event','rc_events',[demoEvent,demoEditedEvent]],['referral','rc_referrals',[demoReferral]]])await db.query(`insert into rc_private.demo_records select $1,id,to_jsonb(t) from public.${table} t where id=any($2::uuid[])`,[kind,ids]);
  for(const id of [null,editor,reader])await assert.rejects(rpc(id,'rc_demo_cleanup'),/permission denied|coordenação/);
  await assert.rejects(as(admin,'delete from rc_private.demo_records'),/permission denied/);
  await assert.rejects(as(admin,'delete from public.rc_demands where id=$1',[demoDemand]),/permission denied/);
  const p=await rpc(admin,'rc_demo_cleanup');assert.equal(p.total,8);assert.equal(p.deleted,false);
  assert.equal((await db.query('select count(*)::int as n from public.rc_demands where id=$1',[demoDemand])).rows[0].n,1);
 });
 await t.test('cleanup preserves edited examples, notes, new referrals and their owners',async()=>{
  const d=(await db.query('select * from public.rc_demands where id=$1',[demoEdited])).rows[0];
  await save(editor,'demand',{...d,title:'Agora é uma demanda do setor'});
  await save(editor,'note',{id:demoNote,note:'Acompanhamento feito pela equipe'});
  await save(editor,'referral',{demandId:demoLinked,department:'Área nova',sentAt:'2026-10-14',due:'2026-10-22',status:'Aguardando retorno',response:''});
  cleanupPreview=await rpc(admin,'rc_demo_cleanup');
  assert.deepEqual([cleanupPreview.demands,cleanupPreview.events,cleanupPreview.referrals,cleanupPreview.members,cleanupPreview.preserved],[1,2,1,0,4]);
 });
 await t.test('cleanup rejects stale confirmation and missing token atomically',async()=>{
  const e=(await db.query('select * from public.rc_events where id=$1',[demoEditedEvent])).rows[0];
  await save(editor,'event',{...e,title:'Compromisso atualizado'});
  await assert.rejects(rpc(admin,'rc_demo_cleanup',[true,cleanupPreview.token]),/lista mudou/);
  await assert.rejects(rpc(admin,'rc_demo_cleanup',[true,null]),/lista mudou/);
  assert.equal((await db.query('select count(*)::int as n from public.rc_demands where id=$1',[demoDemand])).rows[0].n,1);
 });
 await t.test('cleanup deletes only unchanged registered examples and retains audit snapshots',async()=>{
  const p=await rpc(admin,'rc_demo_cleanup');assert.equal(p.total,3);
  const result=await rpc(admin,'rc_demo_cleanup',[true,p.token]);assert.equal(result.deleted,true);
  assert.equal((await db.query('select count(*)::int as n from public.rc_demands where id=$1',[demoDemand])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from public.rc_events where id=$1',[demoEvent])).rows[0].n,0);
  const kept=await rpc(admin,'rc_workspace');
  for(const id of [first.id,demoEdited,demoNote,demoLinked])assert.ok(kept.demands.some(d=>d.id===id));
  assert.ok(kept.members.some(m=>m.id===demoMember));assert.ok(kept.members.some(m=>m.id===admin&&m.authId===admin));
  const logs=await rpc(admin,'rc_history');const log=logs.find(a=>a.action==='Demonstração excluída'&&a.entityId===demoDemand);
  assert.equal(log.before.title,'Exemplo original');assert.equal(log.actorId,admin);assert.equal(log.after,null);
  assert.ok(logs.some(a=>a.entityId===first.id));
  const empty=await rpc(admin,'rc_demo_cleanup');assert.equal(empty.total,0);assert.equal(empty.preserved,5);
  await rpc(admin,'rc_demo_cleanup',[true,empty.token]);assert.equal((await rpc(admin,'rc_history')).length,logs.length);
 });
 await t.test('cleanup removes unused fictitious members without touching real accounts',async()=>{
  const unused=uid(85);await db.query('insert into public.rc_members(id,name,email,role,sample) values($1,$2,$3,$4,1)',[unused,'Exemplo sem vínculos','unused@example.invalid','Equipe']);
  await db.query("insert into rc_private.demo_records select 'member',id,to_jsonb(m) from public.rc_members m where id=$1",[unused]);
  const p=await rpc(admin,'rc_demo_cleanup');assert.equal(p.members,1);
  await rpc(admin,'rc_demo_cleanup',[true,p.token]);
  assert.equal((await db.query('select count(*)::int as n from public.rc_members where id=$1',[unused])).rows[0].n,0);
  assert.equal((await rpc(admin,'rc_workspace')).me.authId,admin);
 });
 await t.test('pending login accounts are coordinator-only and exclude existing access and examples',async()=>{
  for(const id of [null,editor,reader])await assert.rejects(rpc(id,'rc_pending_accounts'),/permission denied|coordenação/);
  const list=await rpc(admin,'rc_pending_accounts');assert.ok(!list.some(m=>m.id===admin||m.id===demoMember));
 });
 await t.test('login activation validates identity, approved email, role and version without passwords',async()=>{
  const memberId=uid(90),authId=uid(91);
  await db.query('insert into public.rc_members(id,name,email,role) values($1,$2,$3,$4)',[memberId,'Nova pessoa','new@example.test','Equipe']);
  const before=await rpc(admin,'rc_pending_accounts');assert.equal(before.find(m=>m.id===memberId).existingAuthId,null);
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[authId,'new@example.test']);
  assert.equal((await rpc(admin,'rc_pending_accounts')).find(m=>m.id===memberId).existingAuthId,authId);
  await assert.rejects(rpc(editor,'rc_link_member_login',[memberId,authId,1]),/coordenação/);
  await assert.rejects(rpc(admin,'rc_link_member_login',[memberId,outsider,1]),/e-mail cadastrado/);
  await assert.rejects(rpc(admin,'rc_link_member_login',[memberId,authId,2]),/cadastro mudou/);
  await assert.rejects(rpc(admin,'rc_link_member_login',[admin,admin,2]),/cadastro mudou/);
  await rpc(admin,'rc_link_member_login',[memberId,authId,1]);
  const account=(await rpc(admin,'rc_workspace')).members.find(m=>m.id===memberId);assert.equal(account.authId,authId);assert.equal(account.version,2);
  await assert.rejects(rpc(admin,'rc_link_member_login',[memberId,authId,2]),/cadastro mudou/);
  const log=(await rpc(admin,'rc_history')).find(a=>a.action==='Acesso de login ativado'&&a.entityId===memberId);
  assert.equal(log.actorId,admin);assert.ok(!Object.hasOwn(log.after,'password'));
 });

 await t.test('all file types attach to demands and events; unregistered files stay private',async()=>{
  const insert="insert into storage.objects(bucket_id,name,owner_id,metadata) values('rc-files',$1,$2,$3)";
  for(const [i,kind,target,mime] of [[910,'demand',first.id,'application/pdf'],[911,'event',event.id,'video/mp4'],[912,'event',event.id,'audio/mpeg'],[913,'demand',first.id,'application/octet-stream']]){
   const path=kind+'/'+target+'/'+uid(i),meta=JSON.stringify({size:1024,mimetype:mime});
   for(const user of [reader,outsider])await assert.rejects(as(user,insert,[path,user,meta]),/row-level security/);
   await as(editor,insert,[path,editor,meta]);
   assert.equal((await as(reader,'select * from storage.objects where name=$1',[path])).rows.length,0);
   await assert.rejects(rpc(admin,'rc_register_attachment',[kind,target,path,'arquivo.bin']),/Conclua/);
   const a=await rpc(editor,'rc_register_attachment',[kind,target,path,'arquivo.bin']);assert.equal(a.mime,mime);assert.equal(a.size,1024);
   assert.equal((await rpc(editor,'rc_register_attachment',[kind,target,path,'arquivo.bin'])).id,a.id);
   assert.equal((await as(reader,'select * from storage.objects where name=$1',[path])).rows.length,1);
   assert.equal((await as(outsider,'select * from storage.objects where name=$1',[path])).rows.length,0);
   assert.equal((await as(null,'select * from storage.objects where name=$1',[path])).rows.length,0);
   await assert.rejects(rpc(reader,'rc_register_attachment',[kind,target,path,'arquivo.bin']),/consulta/);
  }
  for(const [i,size] of [[914,0],[915,52428801]]){
   const path='demand/'+first.id+'/'+uid(i);await as(editor,insert,[path,editor,JSON.stringify({size,mimetype:'text/plain'})]);
   await assert.rejects(rpc(editor,'rc_register_attachment',['demand',first.id,path,'tamanho.txt']),/vazio|50 MB/);
  }
  await assert.rejects(as(editor,insert,['demand/../../x',editor,'{}']),/row-level security/);
  await assert.rejects(as(editor,'delete from public.rc_attachments'),/permission denied/);
  assert.equal((await as(editor,'delete from storage.objects returning id')).rows.length,0);
 });
 await t.test('soft deletion hides demands, linked referrals, files and history; only coordination restores',async()=>{
  const stale=first;
  for(const user of [reader,outsider,null])await assert.rejects(rpc(user,'rc_set_deleted',['demand',first.id,first.version]),/permite|liberado|permission denied/);
  await assert.rejects(rpc(editor,'rc_set_deleted',['member',admin,1]),/inválida/);
  const removed=await rpc(editor,'rc_set_deleted',['demand',first.id,first.version]);
  assert.equal(removed.version,first.version+1);
  const workspace=await rpc(editor,'rc_workspace');assert.ok(!workspace.demands.some(d=>d.id===first.id));assert.ok(!workspace.referrals.some(r=>r.demandId===first.id));
  assert.equal((await as(admin,'select * from public.rc_demands where id=$1',[first.id])).rows.length,0);
  assert.equal((await as(reader,'select * from public.rc_attachments where "demandId"=$1',[first.id])).rows.length,0);
  assert.equal((await as(reader,'select * from public.rc_demand_photos where "demandId"=$1',[first.id])).rows.length,0);
  assert.equal((await as(reader,"select * from storage.objects where name like $1 or name like $2",[first.id+'/%','demand/'+first.id+'/%'])).rows.length,0);
  await assert.rejects(rpc(editor,'rc_history',[first.id]),/não encontrada/);
  await assert.rejects(save(editor,'demand',{...removed,title:'invisível'}),/excluído/);
  await assert.rejects(save(editor,'note',{id:first.id,note:'invisível'}),/não encontrada/);
  await assert.rejects(save(editor,'referral',{demandId:first.id,department:'Área',due:'2026-10-20',sentAt:'2026-10-15',status:'Aguardando retorno',response:''}),/indisponível/);
  await assert.rejects(rpc(editor,'rc_set_deleted',['demand',first.id,removed.version,true]),/perfil/);
  await assert.rejects(rpc(editor,'rc_trash'),/coordenação/);
  const trash=await rpc(admin,'rc_trash');assert.ok(trash.some(r=>r.id===first.id&&r.version===removed.version));
  await assert.rejects(rpc(admin,'rc_set_deleted',['demand',first.id,stale.version,true]),/atualizado/);
  first=await rpc(admin,'rc_set_deleted',['demand',first.id,removed.version,true]);
  assert.ok((await rpc(reader,'rc_workspace')).referrals.some(r=>r.demandId===first.id));
  assert.ok((await as(reader,'select * from public.rc_attachments where "demandId"=$1',[first.id])).rows.length>0);
  const logs=await rpc(admin,'rc_history',[first.id]);assert.ok(logs.some(x=>x.action==='Registro excluído'));assert.ok(logs.some(x=>x.action==='Registro recuperado'));
 });
 await t.test('attachments and referrals have independent recovery; legacy photo cannot bypass trash',async()=>{
  const a=(await as(reader,'select * from public.rc_attachments where bucket=$1',['rc-demand-photos'])).rows[0];
  const gone=await rpc(editor,'rc_set_deleted',['attachment',a.id,a.version]);
  assert.equal((await as(reader,'select * from storage.objects where name=$1',[a.path])).rows.length,0);
  assert.equal((await as(reader,'select * from public.rc_demand_photos where id=$1',[a.id])).rows.length,0);
  const parent=await rpc(editor,'rc_set_deleted',['demand',first.id,first.version]);
  await assert.rejects(rpc(admin,'rc_set_deleted',['attachment',a.id,gone.version,true]),/primeiro/);
  first=await rpc(admin,'rc_set_deleted',['demand',first.id,parent.version,true]);
  assert.equal((await as(reader,'select * from storage.objects where name=$1',[a.path])).rows.length,0);
  await rpc(admin,'rc_set_deleted',['attachment',a.id,gone.version,true]);
  assert.equal((await as(reader,'select * from storage.objects where name=$1',[a.path])).rows.length,1);
  const r=(await rpc(editor,'rc_workspace')).referrals.find(r=>r.id===ref.id);
  const removed=await rpc(editor,'rc_set_deleted',['referral',r.id,r.version]);
  assert.ok(!(await rpc(reader,'rc_workspace')).referrals.some(x=>x.id===r.id));
  await rpc(admin,'rc_set_deleted',['referral',r.id,removed.version,true]);
 });
 await t.test('deleted agenda frees time and recovery checks conflicts and hides event files',async()=>{
  const removed=await rpc(editor,'rc_set_deleted',['event',event.id,event.version]);
  assert.equal((await as(reader,'select * from public.rc_attachments where "eventId"=$1',[event.id])).rows.length,0);
  const {id,version,...data}=event;const replacement=await save(editor,'event',data);
  await assert.rejects(rpc(admin,'rc_set_deleted',['event',event.id,removed.version,true]),/outro compromisso/);
  await rpc(editor,'rc_set_deleted',['event',replacement.id,replacement.version]);
  event=await rpc(admin,'rc_set_deleted',['event',event.id,removed.version,true]);
  assert.ok((await as(reader,'select * from public.rc_attachments where "eventId"=$1',[event.id])).rows.length>0);
 });
 await t.test('deactivation immediately blocks existing sessions and assignments',async()=>{
  await save(admin,'member',{...editorMember,active:false});
  await assert.rejects(rpc(editor,'rc_workspace'),/inativo/);
  await assert.rejects(save(editor,'note',{id:first.id,note:'forbidden'}),/inativo/);
  assert.equal((await as(editor,'select * from public.rc_demands')).rows.length,0);
  assert.equal((await as(editor,'select * from public.rc_demand_photos')).rows.length,0);
  assert.equal((await as(editor,'select * from storage.objects')).rows.length,0);
  await assert.rejects(save(admin,'demand',demand),/responsável ativo/);
 });
 await t.test('deleted auth session invalidates a still-signed token',async()=>{
  await db.query('delete from auth.sessions where user_id=$1',[reader]);
  await assert.rejects(rpc(reader,'rc_workspace'),/Entre novamente/);
  assert.equal((await as(reader,'select * from public.rc_demands')).rows.length,0);
 });
 await t.test('all tables have RLS; no public definer functions or anonymous RPC grants',async()=>{
  const tables=await db.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'rc_%'");assert.equal(tables.rows.length,7);assert.ok(tables.rows.every(x=>x.relrowsecurity));
  const functions=await db.query("select proname,prosecdef from pg_proc where pronamespace='public'::regnamespace and proname like 'rc_%'");assert.ok(functions.rows.every(x=>!x.prosecdef));
  for(const name of ['rc_workspace()','rc_save_record(text,jsonb)','rc_history(uuid)','rc_log_export(jsonb,integer,date)','rc_demo_cleanup(boolean,text)','rc_pending_accounts()','rc_link_member_login(uuid,uuid,integer)','rc_register_demand_photo(uuid,text,text)','rc_register_attachment(text,uuid,text,text)','rc_set_deleted(text,uuid,integer,boolean)','rc_trash()'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed',['anon','public.'+name,'EXECUTE'])).rows[0].allowed,false);
 });
 await db.close();
});
