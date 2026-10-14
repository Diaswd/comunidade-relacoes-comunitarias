import {type State,filterDemands,localDate,monday,addDays,isLate} from './domain.ts';
import {workbook} from './excel.ts';

export function buildExport(s:State,f:Record<string,string>,week:string){
 const ds=filterDemands(s.demands,f,s.today),start=monday(week||s.today),end=addDays(start,6);
 const member=(id:string)=>s.members.find(m=>m.id===id)?.name||'Não atribuído',label=(id:string)=>s.demands.find(d=>d.id===id)?.code||id;
 const sheets=[{name:'Demandas',rows:[['Código','Título','Bairro','Descrição','Prioridade','Responsável','Prazo','Status','Próximo passo','Criada em','Concluída em'],...ds.map(d=>[d.code,d.title,d.neighborhood,d.description,d.priority,member(d.ownerId),d.due,d.status,d.nextStep,d.createdAt,d.closedAt||''])]},
 {name:'Resumo semanal',rows:[['Indicador','Valor'],['Início da semana',start],['Fim da semana',end],['Escopo','Filtros da lista de demandas aplicados'],['Criadas no período',ds.filter(d=>localDate(d.createdAt)>=start&&localDate(d.createdAt)<=end).length],['Concluídas no período',ds.filter(d=>d.closedAt&&localDate(d.closedAt)>=start&&localDate(d.closedAt)<=end).length],['Em aberto hoje',ds.filter(d=>d.status!=='Concluída').length],['Vencidas hoje',ds.filter(d=>isLate(d,s.today)).length],['Observação','Ambiente em validação. Não representa registros oficiais.']]},
 {name:'Encaminhamentos',rows:[['Demanda','Área / secretaria','Data do envio','Prazo de retorno','Situação','Resposta'],...s.referrals.filter(r=>ds.some(d=>d.id===r.demandId)).map(r=>[label(r.demandId),r.department,r.sentAt,r.due,r.status,r.response])]},
 {name:'Agenda da semana',rows:[['Título','Data','Início','Fim','Local','Tipo','Responsável','Situação','Observações'],...s.events.filter(e=>e.date>=start&&e.date<=end).map(e=>[e.title,e.date,e.time,e.endTime,e.location,e.kind,member(e.ownerId),e.status,e.notes])]}];
 return {bytes:workbook(sheets),count:ds.length,start};
}
