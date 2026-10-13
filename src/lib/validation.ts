import {z} from 'zod';import {STATUSES,PRIORITIES} from './domain';
const short=z.string().trim().min(1,'Preencha os campos obrigatórios.').max(180);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Data inválida.');
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const base={id:z.string().max(80).optional(),version:z.number().int().positive().optional()};
export const demandSchema=z.object({...base,title:short,neighborhood:short,description:z.string().trim().min(1).max(4000),priority:z.enum(PRIORITIES),ownerId:short,due:date,status:z.enum(STATUSES),nextStep:z.string().trim().max(1200)});
export const eventSchema=z.object({...base,title:short,date,time,endTime:time,location:short,kind:z.enum(['Reunião interna','Reunião comunitária','Visita']),ownerId:short,notes:z.string().max(2000),status:z.enum(['Agendado','Realizado','Cancelado'])}).refine(e=>e.endTime>e.time,'O horário final deve ser depois do início.');
export const referralSchema=z.object({...base,demandId:short,department:short,due:date,sentAt:date,status:z.enum(['Aguardando retorno','Em atendimento','Respondido']),response:z.string().trim().max(3000)}).refine(r=>r.due>=r.sentAt,'O prazo de retorno não pode ser anterior ao envio.').refine(r=>r.status!=='Respondido'||r.response.length>0,'Descreva a resposta recebida.');
export const memberSchema=z.object({id:z.string().optional(),version:z.number().int().positive().optional(),name:short,jobTitle:z.string().trim().max(180).default(''),email:z.string().email('Informe um e-mail válido.').max(180),role:z.enum(['Coordenação','Equipe','Consulta']),active:z.boolean()});
