export type Candidate={id:string;name:string;email:string;version:number;existingAuthId:string|null;role:string};
type Dependencies={
 authenticate:(authorization:string)=>Promise<boolean>;
 pending:(authorization:string)=>Promise<Candidate[]>;
 create:(email:string,password:string)=>Promise<string>;
 link:(authorization:string,member:Candidate,authId:string)=>Promise<void>;
};
const allowedOrigin='https://diaswd.github.io';
export function createHandler(deps:Dependencies){return async(req:Request)=>{
 const origin=req.headers.get('origin');
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':allowedOrigin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&origin!==allowedOrigin)return reply(403,{error:'Origem não autorizada.'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Método não permitido.'});
 const auth=req.headers.get('authorization')||'';
 try{
  if(!/^Bearer \S+$/.test(auth)||!await deps.authenticate(auth))return reply(401,{error:'Entre novamente no sistema.'});
  let candidates:Candidate[];
  try{candidates=await deps.pending(auth)}catch{return reply(403,{error:'Somente a coordenação ativa pode criar acessos.'})}
  if(Number(req.headers.get('content-length')||0)>15000)return reply(413,{error:'Solicitação muito extensa.'});
  const raw=await req.text();if(raw.length>15000)return reply(413,{error:'Solicitação muito extensa.'});
  let body;try{body=JSON.parse(raw)}catch{return reply(400,{error:'Solicitação inválida.'})}
  if(!body||typeof body.password!=='string'||body.password.length<12||body.password.length>128||!Array.isArray(body.members)||body.members.length<1||body.members.length>50||Object.keys(body).some(k=>!['password','members'].includes(k)))return reply(400,{error:'Informe a senha inicial de 12 a 128 caracteres e até 50 cadastros.'});
  const seen=new Set();
  for(const entry of body.members){
   if(!entry||typeof entry.id!=='string'||!Number.isInteger(entry.version)||seen.has(entry.id)||!candidates.some(c=>c.id===entry.id&&c.version===entry.version))return reply(409,{error:'A lista de acessos mudou. Confira novamente.'});
   seen.add(entry.id);
  }
  const results=[];
  for(const entry of body.members){
   // Recheck the live session, coordinator permission and member before every Auth write.
   let current:Candidate|undefined;
   try{current=(await deps.pending(auth)).find(c=>c.id===entry.id&&c.version===entry.version)}catch{results.push({id:entry.id,status:'failed',message:'Seu acesso mudou. Entre novamente.'});break}
   if(!current){results.push({id:entry.id,status:'failed',message:'Cadastro atualizado por outra pessoa. Confira novamente.'});continue}
   try{
    const existing=Boolean(current.existingAuthId);
    const authId=current.existingAuthId||await deps.create(current.email,body.password);
    await deps.link(auth,current,authId);
    results.push({id:entry.id,status:existing?'linked':'created'});
   }catch{results.push({id:entry.id,status:'failed',message:'Não foi possível concluir este acesso. Confira novamente; contas já criadas terão a senha preservada.'})}
  }
  return reply(200,{results});
 }catch{return reply(500,{error:'Não foi possível concluir. Tente novamente.'})}
}}
