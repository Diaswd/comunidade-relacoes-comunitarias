// Read-only check: no login, no user data, no schema writes.
import {loadEnv} from 'vite';
const env={...loadEnv('development',process.cwd(),''),...process.env};
const url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw Error('Configure a URL e a chave pública em .env.local.');
const headers={apikey:key,'Content-Type':'application/json'};
const auth=await fetch(url+'/auth/v1/settings',{headers});
if(!auth.ok)throw Error('Auth não respondeu: '+auth.status);
const settings=await auth.json();
if(settings.disable_signup!==true)throw Error('O cadastro público precisa estar desativado para o acesso interno.');
if(settings.external?.anonymous_users!==false)throw Error('O acesso anônimo do Auth precisa estar desativado.');
console.log('Auth: cadastro público e login anônimo desativados');
for(const table of ['rc_members','rc_demands','rc_events','rc_referrals','rc_audit']){
 const r=await fetch(`${url}/rest/v1/${table}?select=id&limit=1`,{headers});
 const j=await r.json();if(r.ok&&(!Array.isArray(j)||j.length))throw Error('Acesso anônimo indevido em '+table);
 if(!r.ok&&!['42501','PGRST301'].includes(j.code))throw Error('Verifique a tabela '+table+': '+(j.code||r.status));
 console.log(table+': acesso anônimo bloqueado');
}
const rpc=await fetch(url+'/rest/v1/rpc/rc_workspace',{method:'POST',headers,body:'{}'});
const response=await rpc.json();if(rpc.ok||response.code==='PGRST202')throw Error('RPC ausente ou sem proteção: '+rpc.status);
console.log('Auth acessível; dados e RPC protegidos.');
