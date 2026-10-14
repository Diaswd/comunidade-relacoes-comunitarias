import {useState} from 'react';
import {Trash2} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {previewDemoCleanup,deleteDemonstrations,type DemoCleanup} from '@/lib/api';
import {toast} from 'sonner';

export default function DemoCleanupPanel({onComplete}:{onComplete:()=>Promise<void>}){
 const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[preview,setPreview]=useState<DemoCleanup|null>(null),[confirmation,setConfirmation]=useState(''),[error,setError]=useState('');
 async function review(){
  setOpen(true);setBusy(true);setError('');setPreview(null);setConfirmation('');
  try{setPreview(await previewDemoCleanup())}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function remove(e:React.FormEvent){
  e.preventDefault();if(busy||!preview?.total||confirmation!=='EXCLUIR')return;
  setBusy(true);setError('');
  try{
   const result=await deleteDemonstrations(preview.token);
   setOpen(false);setConfirmation('');
   toast.success(result.deleted?'Dados de demonstração excluídos.':'Não há demonstrações disponíveis para excluir.');
   await onComplete();
  }catch(e){setError((e as Error).message);setPreview(null);setConfirmation('')}finally{setBusy(false)}
 }
 return <><section className="panel demo-cleanup"><div><h2>Dados de demonstração</h2><p>Remova os exemplos importados para começar a organizar o setor. Seu acesso, os novos registros e a auditoria serão mantidos.</p></div><button className="secondary" onClick={review} disabled={busy}><Trash2 size={17}/>Excluir demonstrações</button></section>
 <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v)}}><DialogContent className="record-dialog"><DialogHeader><DialogTitle>Excluir dados de demonstração</DialogTitle><DialogDescription>Confira os exemplos que serão removidos das listas. A exclusão não pode ser desfeita pela plataforma.</DialogDescription></DialogHeader>
 {busy&&!preview&&<p role="status">Conferindo demonstrações…</p>}
 {error&&<p className="error-box" role="alert">{error}</p>}
 {preview&&<><ul className="demo-counts"><li><strong>{preview.demands}</strong> demandas</li><li><strong>{preview.events}</strong> compromissos</li><li><strong>{preview.referrals}</strong> encaminhamentos</li><li><strong>{preview.members}</strong> perfis fictícios sem login</li></ul>
 <p className="form-help">Exemplos alterados, com novos acompanhamentos ou vinculados a novos registros são preservados. Contas reais e registros de auditoria não são excluídos.</p>
 {preview.preserved>0&&<p className="notice">{preview.preserved} exemplos serão preservados por terem alterações ou vínculos com registros mantidos.</p>}
 {preview.total===0?<p role="status" className="notice">Não há demonstrações disponíveis para excluir.</p>:<form className="record-form" onSubmit={remove}><label className="field">Digite EXCLUIR para confirmar<input className="control" autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy}/></label><footer className="form-footer"><button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Cancelar</button><button className="danger-button" disabled={busy||confirmation!=='EXCLUIR'}>{busy?'Excluindo…':`Excluir ${preview.total} demonstrações`}</button></footer></form>}</>}
 {(!preview||preview.total===0)&&<footer className="form-footer"><button className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Fechar</button>{error&&<button className="primary" disabled={busy} onClick={review}>Conferir novamente</button>}</footer>}
 </DialogContent></Dialog></>;
}
