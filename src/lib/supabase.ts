import {createClient} from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url?.startsWith('https://') && key?.startsWith('sb_publishable_'));
// Public application key only. Authorization always lives in Postgres.
export const supabase = configured ? createClient(url, key, {
  auth: {flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true},
}) : null;
export function getClient(){if(!supabase)throw Error('Configure a URL e a chave pública do Supabase.');return supabase;}
