import {getClient} from './supabase';
import {withDeadline} from './request-deadline';
export type Attachment={id:string;demandId:string|null;eventId:string|null;bucket:string;path:string;name:string;mime:string;size:number;createdAt:string;version:number};
export const MAX_FILE_SIZE=50*1024*1024;
export function validateFile(file:Pick<File,'name'|'size'>){
 if(!file.size)throw Error('O arquivo '+file.name+' está vazio.');
 if(file.size>MAX_FILE_SIZE)throw Error('O arquivo '+file.name+' ultrapassa 50 MB.');
}
export function safeFileName(name:string){return name.replace(/[\u0000-\u001f\u007f\\/]/g,'_').slice(0,180).trim()||'Arquivo';}
export function previewKind(mime:string){
 if(['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(mime))return 'image';
 if(['video/mp4','video/webm','video/ogg'].includes(mime))return 'video';
 if(['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm','audio/x-wav','audio/flac'].includes(mime))return 'audio';
 return null;
}
export async function listAttachments(kind:'demand'|'event',id:string){
 const{data,error}=await withDeadline(s=>getClient().from('rc_attachments').select('*').eq(kind==='demand'?'demandId':'eventId',id).order('createdAt').abortSignal(s),{timeoutMs:15000,message:'A consulta dos arquivos demorou. Tente novamente.'});
 if(error)throw Error(error.message);return data as Attachment[];
}
export async function attachmentBlob(a:Attachment){
 const{data,error}=await withDeadline(()=>getClient().storage.from(a.bucket).download(a.path),{timeoutMs:120000,message:'O arquivo demorou a baixar. Tente novamente.'});
 if(error||!data)throw Error('Não foi possível baixar o arquivo. Atualize a página e tente novamente.');return data;
}
export async function sendAttachment(kind:'demand'|'event',id:string,file:File,path:string){
 validateFile(file);const client=getClient();
 const{error}=await withDeadline(()=>client.storage.from('rc-files').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false,cacheControl:'0'}),{timeoutMs:120000,message:'O envio demorou. Tente novamente para concluir este mesmo arquivo.'});
 // Reuse a stable path when an upload succeeded but its response/registration was lost.
 if(error&&String((error as any).statusCode)!=='409')throw Error('Não foi possível enviar '+file.name+'. Confira a conexão e tente novamente.');
 const result=await withDeadline(s=>client.rpc('rc_register_attachment',{p_kind:kind,p_id:id,p_path:path,p_name:safeFileName(file.name)}).abortSignal(s),{timeoutMs:15000,message:'O arquivo foi enviado. Tente novamente para concluir o vínculo.'});
 if(result.error)throw Error(result.error.message);
}
