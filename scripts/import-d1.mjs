// Generates a reviewable, transactional import. Never contacts either database.
// The output contains source data and must stay outside Git.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [input,adminId,output]=process.argv.slice(2);
if(!input||!/^[0-9a-f-]{36}$/i.test(adminId||'')||!output)throw Error('Use: node scripts/import-d1.mjs backup.json ADMIN_UUID output.local.sql');
const source=JSON.parse(await readFile(input,'utf8'));
const uuid=id=>{if(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return id;const b=createHash('sha256').update('comunidade:d1:'+id).digest().subarray(0,16);b[6]=(b[6]&15)|0x80;b[8]=(b[8]&63)|0x80;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`};
const memberId=id=>id==='owner'?adminId:uuid(id);
const itemIds=new Set(source.items.filter(x=>['demand','event','referral'].includes(x.kind)).map(x=>x.id));
const convert=data=>{if(!data)return null;const d=typeof data==='string'?JSON.parse(data):structuredClone(data);if(d.id)d.id=itemIds.has(d.id)?uuid(d.id):memberId(d.id);if(d.ownerId)d.ownerId=memberId(d.ownerId);if(d.demandId)d.demandId=uuid(d.demandId);return d};
const members=source.members.filter(m=>m.id!=='owner').map(m=>({id:memberId(m.id),authId:null,name:m.name,email:m.email||`${m.id}@example.invalid`,jobTitle:'',role:m.role,active:m.active,sample:m.sample,version:1}));
const rows={rc_members:members,rc_demands:[],rc_events:[],rc_referrals:[],rc_audit:[]};
for(const item of source.items){const table={demand:'rc_demands',event:'rc_events',referral:'rc_referrals'}[item.kind];if(table)rows[table].push({...convert(item.data),version:item.version});}
for(const a of source.audit)rows.rc_audit.push({id:uuid(a.id),entityId:itemIds.has(a.entity_id)?uuid(a.entity_id):a.entity_id,actorId:null,actor:a.actor,action:a.action,before:convert(a.before),after:convert(a.after),note:a.note,at:a.at});
const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
let sql="begin;\nselect pg_advisory_xact_lock(hashtextextended('rc_workspace_writes',0));\n";
sql+=`do $$begin if not exists(select 1 from public.rc_members where id='${adminId}' and role='Coordenação' and active=1) then raise exception 'Administrador de destino inválido';end if;end $$;\n`;
for(const[table,data]of Object.entries(rows))if(data.length)sql+=`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},${literal(data)}) on conflict(id) do nothing;\n`;
sql+=`insert into public.rc_audit("entityId","actorId",actor,action,"after",note) select 'migration','${adminId}',name,'Migração do protótipo D1',${literal(Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v.length])))},'Importação preserva os exemplos fictícios e seu histórico. Banco original mantido.' from public.rc_members where id='${adminId}';\ncommit;\n`;
await writeFile(output,sql);console.log(JSON.stringify({counts:Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v.length])),output}));
