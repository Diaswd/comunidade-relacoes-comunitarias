import {useState} from 'react';
import {setDeleted,type DeletableKind} from '@/lib/api';
export default function DeleteRecord({kind,id,version,title,onDeleted}:{kind:DeletableKind;id:string;version:number;title:string;onDeleted:()=>void|Promise<void>}){
 const[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function remove(){setBusy(true);setError('');try{await setDeleted(kind,id,version);await onDeleted();setConfirm(false)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <div className="delete-record">{confirm?<div className="delete-confirm" role="group" aria-label="Confirmar exclusão"><strong>Excluir “{title}”?</strong><p>O registro sairá das listas. A Coordenação poderá recuperá-lo na lixeira.{kind==='demand'?' Os encaminhamentos e arquivos vinculados também ficarão ocultos.':''}</p><div className="action-row"><button type="button" className="secondary" disabled={busy} onClick={()=>setConfirm(false)}>Manter registro</button><button type="button" className="secondary danger-button" disabled={busy} onClick={remove}>{busy?'Excluindo…':'Confirmar exclusão'}</button></div></div>:<button type="button" className="text-button danger-button" onClick={()=>setConfirm(true)}>Excluir{kind==='attachment'?' arquivo':''}</button>}{error&&<p role="alert" className="error-box">{error}</p>}</div>
}
