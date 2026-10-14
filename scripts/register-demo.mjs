// Register known examples from the reviewed original import, never from all current rows.
// Output stays local. This script neither connects to a database nor deletes records.
import {readFile,writeFile} from 'node:fs/promises';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Use: node scripts/register-demo.mjs import-d1.local.sql manifest.local.sql');
const source=await readFile(input,'utf8');
const pattern=/insert into public\.(rc_members|rc_demands|rc_events|rc_referrals) select \* from jsonb_populate_recordset\(null::public\.\1,('(?:[^']|'')*'::jsonb)\) on conflict\(id\) do nothing;/g;
const kinds={rc_members:'member',rc_demands:'demand',rc_events:'event',rc_referrals:'referral'};
let sql="begin;\nselect pg_advisory_xact_lock(hashtextextended('rc_workspace_writes',0));\n",tables=0;
for(const match of source.matchAll(pattern)){
 const [,table,literal]=match;tables++;
 sql+=`insert into rc_private.demo_records(kind,id,baseline) select '${kinds[table]}',s.id,to_jsonb(s) from jsonb_populate_recordset(null::public.${table},${literal}) s join public.${table} t on t.id=s.id ${table==='rc_members'?'where s.sample=1 and s."authId" is null':''} on conflict(kind,id) do nothing;\n`;
}
if(tables!==4)throw Error('O arquivo deve conter as quatro tabelas da importação revisada.');
sql+='commit;\nselect kind,count(*) from rc_private.demo_records group by kind order by kind;\n';
await writeFile(output,sql);console.log('Manifesto local preparado para os exemplos da importação original.');
