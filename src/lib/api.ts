import {getClient} from './supabase';
import {type State,type Audit,filterDemands,localDate,monday,addDays,isLate} from './domain';
import {workbook} from './excel';
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
 const ds=filterDemands(s.demands,f,s.today),start=monday(week||s.today),end=addDays(start,6);
 const member=(id:string)=>s.members.find(m=>m.id===id)?.name||'Não atribuído',label=(id:string)=>s.demands.find(d=>d.id===id)?.code||id;
 const sheets=[{name:'Demandas',rows:[['Código','Título','Bairro','Descrição','Prioridade','Responsável','Prazo','Status','Próximo passo','Criada em','Concluída em'],...ds.map(d=>[d.code,d.title,d.neighborhood,d.description,d.priority,member(d.ownerId),d.due,d.status,d.nextStep,d.createdAt,d.closedAt||''])]},
 {name:'Resumo semanal',rows:[['Indicador','Valor'],['Início da semana',start],['Fim da semana',end],['Escopo','Filtros da lista de demandas aplicados'],['Criadas no período',ds.filter(d=>localDate(d.createdAt)>=start&&localDate(d.createdAt)<=end).length],['Concluídas no período',ds.filter(d=>d.closedAt&&localDate(d.closedAt)>=start&&localDate(d.closedAt)<=end).length],['Em aberto hoje',ds.filter(d=>d.status!=='Concluída').length],['Vencidas hoje',ds.filter(d=>isLate(d,s.today)).length],['Observação','Ambiente em validação. Não representa registros oficiais.']]},
 {name:'Encaminhamentos',rows:[['Demanda','Área / secretaria','Data do envio','Prazo de retorno','Situação','Resposta'],...s.referrals.filter(r=>ds.some(d=>d.id===r.demandId)).map(r=>[label(r.demandId),r.department,r.sentAt,r.due,r.status,r.response])]},
 {name:'Agenda da semana',rows:[['Título','Data','Início','Fim','Local','Tipo','Responsável','Situação','Observações'],...s.events.filter(e=>e.date>=start&&e.date<=end).map(e=>[e.title,e.date,e.time,e.endTime,e.location,e.kind,member(e.ownerId),e.status,e.notes])]}];
 const bytes=workbook(sheets);
 await call('rc_log_export',{p_filters:f,p_count:ds.length,p_week:start});
 const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const a=document.createElement('a');a.href=url;a.download='comunidade-'+s.today+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
