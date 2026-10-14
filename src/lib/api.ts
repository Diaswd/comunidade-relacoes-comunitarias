import {getClient} from './supabase';
import {type State,type Audit} from './domain';
import {buildExport} from './export-data';
import {demandSchema,eventSchema,referralSchema,memberSchema} from './validation';
async function call<T>(name:string,args:Record<string,unknown>={}){
  const {data,error}=await getClient().rpc(name,args);
  if(error){
    if(error.code==='PGRST202'||error.code==='42883')throw Error('A estrutura do banco ainda não foi aplicada ao Supabase. Solicite a configuração à coordenação.');
    if(error.code==='23505')throw Error('Já existe um cadastro com esses dados.');
    if(error.code==='23514'||error.code==='22P02'||error.code==='22007'||error.code==='22008'||error.code==='23502')throw Error('Confira os campos obrigatórios, datas e opções do formulário.');
    if(error.code==='23503')throw Error('O registro vinculado não existe mais. Atualize a lista.');
    throw Error(error.message||'Não foi possível concluir. Tente novamente.');
  }
  return data as T;
}
export async function loadWorkspace(){return call<State>('rc_workspace');}
export async function saveRecord(action:string,data:unknown){
  const schema={demand:demandSchema,event:eventSchema,referral:referralSchema,member:memberSchema}[action];
  let parsed=data;
  if(schema){const r=schema.safeParse(data);if(!r.success)throw Error(r.error.issues[0]?.message||'Confira os campos.');parsed=r.data;}
  return call('rc_save_record',{p_kind:action,p_data:parsed});
}
export async function readHistory(id?:string){
  const rows=await call<(Omit<Audit,'before'|'after'>&{before:unknown;after:unknown})[]>('rc_history',{p_entity:id||null});
  return rows.map(a=>({...a,before:a.before?JSON.stringify(a.before):null,after:a.after?JSON.stringify(a.after):null}));
}
export async function downloadExcel(s:State,f:Record<string,string>,week:string){
 const {bytes,count,start}=buildExport(s,f,week);
 await call('rc_log_export',{p_filters:f,p_count:count,p_week:start});
 const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const a=document.createElement('a');a.href=url;a.download='comunidade-'+s.today+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
