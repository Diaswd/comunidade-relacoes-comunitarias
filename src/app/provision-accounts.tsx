import {useState} from 'react';
import {KeyRound} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {pendingAccounts,provisionAccounts,type PendingAccount} from '@/lib/api';
import {toast} from 'sonner';

export default function ProvisionAccounts({onComplete}:{onComplete:()=>Promise<void>}){
 const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[accounts,setAccounts]=useState<PendingAccount[]|null>(null),[password,setPassword]=useState(''),[error,setError]=useState('');
 async function review(){setOpen(true);setBusy(true);setError('');setPassword('');setAccounts(null);try{setAccounts((await pendingAccounts()).slice(0,50))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function submit(e:React.FormEvent){
  e.preventDefault();if(busy||!accounts?.length)return;setBusy(true);setError('');
  try{
   const response=await provisionAccounts(password,accounts);setPassword('');
   const created=response.results.filter(r=>r.status==='created').length,linked=response.results.filter(r=>r.status==='linked').length,failed=response.results.filter(r=>r.status==='failed');
   if(created||linked)toast.success(`${created} contas criadas; ${linked} contas existentes vinculadas.`);
   await onComplete();
   if(failed.length){setError('Alguns acessos não foram concluídos. Confira a lista novamente. As contas já criadas mantêm a senha inicial informada.');setAccounts(null)}else setOpen(false);
  }catch(e){setPassword('');setAccounts(null);setError((e as Error).message)}finally{setBusy(false)}
 }
 return <><section className="panel account-provision"><div><h2>Acessos de login</h2><p>Crie os acessos pendentes com uma senha inicial comum. Cada pessoa poderá alterá-la após entrar. Contas que já existem mantêm a senha atual.</p></div><button className="secondary" onClick={review} disabled={busy}><KeyRound size={17}/>Criar acessos da equipe</button></section>
 <Dialog open={open} onOpenChange={v=>{if(!busy){setOpen(v);if(!v)setPassword('')}}}><DialogContent className="record-dialog"><DialogHeader><DialogTitle>Criar acessos da equipe</DialogTitle><DialogDescription>A senha inicial será usada somente nas contas novas desta lista. Seu acesso e as senhas das contas existentes não serão alterados.</DialogDescription></DialogHeader>
 {busy&&!accounts&&<p role="status">Conferindo contas…</p>}{error&&<p className="error-box" role="alert">{error}</p>}
 {accounts&&(!accounts.length?<p className="notice">Todos os integrantes ativos já têm acesso vinculado.</p>:<form className="record-form" onSubmit={submit}><ul className="account-list">{accounts.map(a=><li key={a.id}><strong>{a.name}</strong><span>{a.email} · {a.role}</span><small>{a.existingAuthId?'Conta existente: senha preservada':'Nova conta: receberá a senha inicial'}</small></li>)}</ul><label className="field">Senha inicial para as contas novas<input type="password" className="control" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label><p className="form-help">Use pelo menos 12 caracteres. Não será enviado e-mail. A senha não fica salva no código nem na auditoria. Até 50 acessos por vez.</p><footer className="form-footer"><button type="button" className="secondary" disabled={busy} onClick={()=>{setOpen(false);setPassword('')}}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Criando acessos…':`Criar ${accounts.length} acessos`}</button></footer></form>)}
 {(!accounts||!accounts.length)&&<footer className="form-footer"><button className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Fechar</button>{error&&<button className="primary" disabled={busy} onClick={review}>Conferir novamente</button>}</footer>}
 </DialogContent></Dialog></>;
}
