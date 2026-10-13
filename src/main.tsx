import React, {useEffect,useState,Suspense,lazy} from 'react';
import {createRoot} from 'react-dom/client';
import type {Session} from '@supabase/supabase-js';
import {Handshake,ShieldCheck} from 'lucide-react';
const Workspace = lazy(()=>import('./app/workspace'));
import {configured,getClient,redirectUrl} from './lib/supabase';
import './app/globals.css';

type Mode='login'|'signup'|'forgot'|'recovery';
function App(){
  const[session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(configured),[recovering,setRecovering]=useState(false);
  useEffect(()=>{
    if(!configured)return;
    let live=true;
    const {data:{subscription}}=getClient().auth.onAuthStateChange((event,next)=>{
      if(!live)return;setSession(next);setLoading(false);
      if(event==='PASSWORD_RECOVERY'){sessionStorage.setItem('rc-recovery','1');setRecovering(true)}
      if(event==='SIGNED_OUT'){sessionStorage.removeItem('rc-recovery');setRecovering(false)}
    });
    getClient().auth.getSession().then(({data,error})=>{if(live){setSession(error?null:data.session);setRecovering(sessionStorage.getItem('rc-recovery')==='1');setLoading(false)}});
    return()=>{live=false;subscription.unsubscribe()};
  },[]);
  if(loading)return <main className="auth-layout"><p role="status">Carregando seu acesso…</p></main>;
  if(session&&!recovering)return <Suspense fallback={<main className="auth-layout"><p role="status">Carregando o espaço da equipe…</p></main>}><Workspace key={session.user.id}/></Suspense>;
  return <Access recovery={recovering} onRecovered={()=>{sessionStorage.removeItem('rc-recovery');setRecovering(false)}}/>;
}
function Access({recovery,onRecovered}:{recovery:boolean;onRecovered:()=>void}){
  const[mode,setMode]=useState<Mode>(recovery?'recovery':'login'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{if(recovery)setMode('recovery')},[recovery]);
  function change(next:Mode){setMode(next);setError('');setMessage('');setPassword('');setConfirmation('')}
  async function submit(e:React.FormEvent){
    e.preventDefault();if(busy)return;setError('');setMessage('');
    if((mode==='signup'||mode==='recovery')&&password!==confirmation){setError('As senhas precisam ser iguais.');return}
    setBusy(true);
    try{
      const auth=getClient().auth;
      if(mode==='login'){const {error}=await auth.signInWithPassword({email:email.trim(),password});if(error)throw error;}
      if(mode==='signup'){const {error}=await auth.signUp({email:email.trim(),password,options:{emailRedirectTo:redirectUrl()}});if(error)throw error;setMessage('Confira seu e-mail para confirmar o cadastro. O acesso aos dados depende da autorização da coordenação.');setPassword('');setConfirmation('');}
      if(mode==='forgot'){const{error}=await auth.resetPasswordForEmail(email.trim(),{redirectTo:redirectUrl()});if(error)throw error;setMessage('Se o endereço estiver cadastrado, você receberá as instruções para redefinir a senha.');}
      if(mode==='recovery'){const{error}=await auth.updateUser({password});if(error)throw error;setPassword('');setConfirmation('');onRecovered();}
    }catch(e){const raw=(e as Error).message;setError(/invalid login/i.test(raw)?'E-mail ou senha inválidos.':/email not confirmed/i.test(raw)?'Confirme seu e-mail antes de entrar.':/rate limit|too many/i.test(raw)?'Muitas tentativas. Aguarde alguns minutos e tente novamente.':/email address not authorized|not allowed.*email/i.test(raw)?'O envio de e-mail precisa ser configurado pela coordenação no Supabase.':/signup.*disabled/i.test(raw)?'O cadastro de contas está desativado. Entre em contato com a coordenação.':/fetch|network/i.test(raw)?'Não foi possível conectar. Confira sua conexão e tente novamente.':raw)}finally{setBusy(false)}
  }
  const titles={login:'Entre no espaço da equipe',signup:'Primeiro acesso',forgot:'Recuperar acesso',recovery:'Defina uma nova senha'};
  return <main className="auth-layout"><section className="auth-intro"><div className="brand"><span className="brand-icon"><Handshake size={27}/></span><div>comunidade<span>RELAÇÕES COMUNITÁRIAS</span></div></div><h1>O trabalho do setor,<br/>em um só lugar.</h1><p>Organize demandas, acompanhe prazos e prepare os próximos passos da equipe.</p><div className="auth-note"><ShieldCheck size={22}/><span>Acesso individual.<br/>Responsabilidade compartilhada.</span></div><small>São Leopoldo · Ambiente em validação</small></section><section className="auth-card"><p className="eyebrow">ESPAÇO DA EQUIPE</p><h2>{titles[mode]}</h2><p className="form-help">{mode==='signup'?'Use o e-mail cadastrado pela coordenação. Confirmar a conta não concede acesso automaticamente.':mode==='forgot'?'Informe seu e-mail para receber o link de recuperação.':'Use seu e-mail e sua senha para continuar.'}</p>{!configured&&<p role="alert" className="error-box">A conexão ainda precisa ser configurada. Informe a URL e a chave pública do Supabase nas variáveis do projeto.</p>}<form onSubmit={submit}>
    {mode!=='recovery'&&<label className="field">E-mail<input type="email" className="control" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={180}/></label>}
    {mode!=='forgot'&&<label className="field">Senha<input type="password" className="control" autoComplete={mode==='login'?'current-password':'new-password'} minLength={mode==='login'?1:12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} required/></label>}
    {(mode==='signup'||mode==='recovery')&&<><p className="form-help">Use pelo menos 12 caracteres.</p><label className="field">Confirme a senha<input type="password" className="control" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} minLength={12} maxLength={128} required/></label></>}
    {error&&<p className="error-box" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}
    <button className="primary" disabled={busy||!configured}>{busy?'Aguarde…':{login:'Entrar',signup:'Criar minha senha',forgot:'Enviar link',recovery:'Salvar nova senha'}[mode]}</button>
  </form>{mode==='login'?<div className="auth-links"><button className="text-button" onClick={()=>change('signup')}>Primeiro acesso</button><button className="text-button" onClick={()=>change('forgot')}>Esqueci minha senha</button></div>:mode!=='recovery'&&<button className="text-button" onClick={()=>change('login')}>Voltar para entrar</button>}<p className="form-help auth-footnote">Durante a validação, use dados fictícios. As permissões são definidas pela coordenação.</p></section></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
