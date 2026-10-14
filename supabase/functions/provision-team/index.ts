import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import {createHandler} from './handler.ts';

const url=Deno.env.get('SUPABASE_URL')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const options={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,service,options);
const client=(authorization:string)=>createClient(url,anon,{...options,global:{headers:{Authorization:authorization}}});
Deno.serve(createHandler({
 async authenticate(authorization){const{data,error}=await client(authorization).auth.getUser();return !error&&Boolean(data.user)},
 async pending(authorization){const{data,error}=await client(authorization).rpc('rc_pending_accounts');if(error)throw error;return data},
 async create(email,password){const{data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});if(error||!data.user)throw Error('account_creation_failed');return data.user.id},
 async link(authorization,member,authId){const{error}=await client(authorization).rpc('rc_link_member_login',{p_member:member.id,p_auth:authId,p_version:member.version});if(error)throw error}
}));
