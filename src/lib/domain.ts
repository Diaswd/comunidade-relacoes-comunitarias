export const STATUSES=['Nova','Em triagem','Em andamento','Aguardando retorno','Concluída'] as const;
export const PRIORITIES=['Baixa','Normal','Alta','Urgente'] as const;
export type Member={id:string;authId:string|null;name:string;email:string|null;role:'Coordenação'|'Equipe'|'Consulta';active:number;sample:number;jobTitle:string;version:number};
export type Demand={id:string;code:string;title:string;neighborhood:string;description:string;priority:string;ownerId:string;due:string;status:string;nextStep:string;createdAt:string;updatedAt:string;closedAt:string|null;version:number};
export type Event={id:string;title:string;date:string;time:string;endTime:string;location:string;kind:string;ownerId:string;notes:string;status:string;version:number};
export type Referral={id:string;demandId:string;department:string;due:string;sentAt:string;status:string;response:string;version:number};
export type Audit={id:string;entityId:string;actor:string;action:string;before:string|null;after:string|null;note:string;at:string};
export type State={me:Member;members:Member[];demands:Demand[];events:Event[];referrals:Referral[];today:string};
export function todayISO(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
export function addDays(s:string,n:number){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function monday(s:string){const d=new Date(s+'T12:00:00Z');return addDays(s,-((d.getUTCDay()+6)%7))}
export function dateLabel(s:string,long=false){if(!s)return 'Sem data';return new Date(s.slice(0,10)+'T12:00:00Z').toLocaleDateString('pt-BR',{day:'2-digit',month:long?'long':'2-digit',timeZone:'UTC'})}
export function stamp(s:string){return new Date(s).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})}
export function isLate(d:Demand,today:string){return d.status!=='Concluída'&&d.due<today}
export function filterDemands(ds:Demand[],f:Record<string,string>,t:string){return ds.filter(d=>(!f.q||(d.title+' '+d.description+' '+d.code+' '+d.neighborhood).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(f.q.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()))&&(!f.status||f.status==='Todas'||(f.status==='Em aberto'?d.status!=='Concluída':d.status===f.status))&&(!f.neighborhood||f.neighborhood==='Todos'||d.neighborhood===f.neighborhood)&&(!f.priority||f.priority==='Todas'||d.priority===f.priority)&&(!f.ownerId||f.ownerId==='Todos'||d.ownerId===f.ownerId)&&(!f.deadline||f.deadline==='Todos'||(f.deadline==='Vencidos'?isLate(d,t):f.deadline==='Hoje'?d.due===t&&d.status!=='Concluída':d.due>=monday(t)&&d.due<=addDays(monday(t),6))))}


export function localDate(value:string){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))}
