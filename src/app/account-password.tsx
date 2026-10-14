import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {getClient} from '@/lib/supabase';
import {toast} from 'sonner';

export default function AccountPassword(){
 const[open,setOpen]=useState(false),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function close(){if(busy)return;setOpen(false);setPassword('');setConfirmation('');setError('')}
 async function save(e:React.FormEvent){
  e.preventDefault();if(busy)return;setError('');
  if(password!==confirmation){setError('As senhas precisam ser iguais.');return}
  setBusy(true);
  try{
   const{error}=await getClient().auth.updateUser({password});if(error)throw error;
   setPassword('');setConfirmation('');setOpen(false);toast.success('Sua senha foi alterada.');
  }catch(e){setError(/same password/i.test((e as Error).message)?'Escolha uma senha diferente da atual.':/reauth|session|jwt/i.test((e as Error).message)?'Saia e entre novamente antes de alterar a senha.':(e as Error).message)}finally{setBusy(false)}
 }
 return <><button className="text-button" onClick={()=>setOpen(true)}>Alterar minha senha</button><Dialog open={open} onOpenChange={v=>{if(v)setOpen(true);else close()}}><DialogContent className="record-dialog"><DialogHeader><DialogTitle>Alterar minha senha</DialogTitle><DialogDescription>Use pelo menos 12 caracteres. A alteração é feita diretamente na sua conta, sem confirmação por e-mail.</DialogDescription></DialogHeader><form className="record-form" onSubmit={save}><fieldset className="form-grid" disabled={busy}><label className="field wide">Nova senha<input className="control" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="field wide">Confirme a nova senha<input className="control" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label></fieldset>{error&&<p className="error-box" role="alert">{error}</p>}<footer className="form-footer"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Salvando…':'Salvar nova senha'}</button></footer></form></DialogContent></Dialog></>;
}
