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
  const next=await save(admin,'demand',{...first,status:'Em andamento'});assert.equal(next.version,2);
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
  await assert.rejects(save(editor,'referral',{...data,demandId:uid(99)}),/foreign key/);
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
 await t.test('deactivation immediately blocks existing sessions and assignments',async()=>{
  await save(admin,'member',{...editorMember,active:false});
  await assert.rejects(rpc(editor,'rc_workspace'),/inativo/);
  await assert.rejects(save(editor,'note',{id:first.id,note:'forbidden'}),/inativo/);
  assert.equal((await as(editor,'select * from public.rc_demands')).rows.length,0);
  await assert.rejects(save(admin,'demand',demand),/responsável ativo/);
 });
 await t.test('deleted auth session invalidates a still-signed token',async()=>{
  await db.query('delete from auth.sessions where user_id=$1',[reader]);
  await assert.rejects(rpc(reader,'rc_workspace'),/Entre novamente/);
  assert.equal((await as(reader,'select * from public.rc_demands')).rows.length,0);
 });
 await t.test('all tables have RLS; no public definer functions or anonymous RPC grants',async()=>{
  const tables=await db.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'rc_%'");assert.equal(tables.rows.length,5);assert.ok(tables.rows.every(x=>x.relrowsecurity));
  const functions=await db.query("select proname,prosecdef from pg_proc where pronamespace='public'::regnamespace and proname like 'rc_%'");assert.ok(functions.rows.every(x=>!x.prosecdef));
  for(const name of ['rc_workspace()','rc_save_record(text,jsonb)','rc_history(uuid)','rc_log_export(jsonb,integer,date)'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed',['anon','public.'+name,'EXECUTE'])).rows[0].allowed,false);
 });
 await db.close();
});
