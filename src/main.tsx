import React, {useEffect,useState,Suspense,lazy} from 'react';
import {createRoot} from 'react-dom/client';
import type {Session} from '@supabase/supabase-js';
import {Handshake,ShieldCheck} from 'lucide-react';
import {configured,getClient} from './lib/supabase';
import './app/globals.css';

const Workspace = lazy(()=>import('./app/workspace'));
function App(){
  const[session,setSession]=useState<Session|null>(null),[loading,setLoading]=useState(configured);
  useEffect(()=>{
    if(!configured)return;
    let live=true;
    const {data:{subscription}}=getClient().auth.onAuthStateChange((_event,next)=>{
      if(live){setSession(next);setLoading(false)}
    });
    getClient().auth.getSession().then(({data,error})=>{
      if(live){setSession(error?null:data.session);setLoading(false)}
    });
    return()=>{live=false;subscription.unsubscribe()};
  },[]);
  if(loading)return <main className="auth-layout"><p role="status">Carregando seu acesso…</p></main>;
  if(session)return <Suspense fallback={<main className="auth-layout"><p role="status">Carregando o espaço da equipe…</p></main>}><Workspace key={session.user.id}/></Suspense>;
  return <Access/>;
}
function Access(){
  const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[help,setHelp]=useState('');
  async function submit(e:React.FormEvent){
    e.preventDefault();if(busy)return;setError('');setBusy(true);
    try{
      const {error}=await getClient().auth.signInWithPassword({email:email.trim(),password});
      if(error)throw error;
      setPassword('');
    }catch(e){
      const raw=(e as Error).message;
      setError(/invalid login/i.test(raw)?'E-mail ou senha inválidos.':/email not confirmed/i.test(raw)?'A conta precisa ser ativada pelo administrador. Procure a coordenação.':/rate limit|too many/i.test(raw)?'Muitas tentativas. Aguarde alguns minutos e tente novamente.':/fetch|network/i.test(raw)?'Não foi possível conectar. Confira sua conexão e tente novamente.':raw);
    }finally{setBusy(false)}
  }
  return <main className="auth-layout">
    <section className="auth-intro">
      <div className="brand"><span className="brand-icon"><Handshake size={27}/></span><div>comunidade<span>RELAÇÕES COMUNITÁRIAS</span></div></div>
      <h1>O trabalho do setor,<br/>em um só lugar.</h1>
      <p>Organize demandas, acompanhe prazos e prepare os próximos passos da equipe.</p>
      <div className="auth-note"><ShieldCheck size={22}/><span>Acesso individual.<br/>Responsabilidade compartilhada.</span></div>
      <small>São Leopoldo · Ambiente em validação</small>
    </section>
    <section className="auth-card">
      <p className="eyebrow">ESPAÇO DA EQUIPE</p><h2>Entre no espaço da equipe</h2>
      <p className="form-help">Use o e-mail e a senha do seu acesso interno. Não é necessário confirmar por e-mail.</p>
      {!configured&&<p role="alert" className="error-box">A conexão ainda precisa ser configurada pela administração do sistema.</p>}
      <form onSubmit={submit}>
        <label className="field">E-mail<input type="email" className="control" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={180}/></label>
        <label className="field">Senha<input type="password" className="control" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={128}/></label>
        {error&&<p className="error-box" role="alert">{error}</p>}
        <button className="primary" disabled={busy||!configured}>{busy?'Aguarde…':'Entrar'}</button>
      </form>
      <div className="auth-links">
        <button className="text-button" onClick={()=>setHelp('Os acessos são criados pela administração do setor. Solicite seu cadastro à coordenação e entre com as credenciais recebidas. Não há cadastro público.')}>Como acessar</button>
        <button className="text-button" onClick={()=>setHelp('Procure a coordenação para solicitar a redefinição da senha. A recuperação é interna, sem envio de e-mail.')}>Esqueci minha senha</button>
      </div>
      {help&&<p className="notice" role="status">{help}</p>}
      <p className="form-help auth-footnote">Durante a validação, use dados fictícios. As permissões são definidas pela coordenação.</p>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
