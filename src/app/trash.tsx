import {useState} from 'react';
import {readTrash,setDeleted,type TrashItem} from '@/lib/api';
import {stamp} from '@/lib/domain';
const labels={demand:'Demanda',event:'Compromisso',referral:'Encaminhamento',attachment:'Arquivo'};
export default function Trash({onChanged}:{onChanged:()=>Promise<void>}){
 const[rows,setRows]=useState<TrashItem[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){setBusy(true);setError('');try{setRows(await readTrash())}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function restore(r:TrashItem){setBusy(true);setError('');try{await setDeleted(r.kind,r.id,r.version,true);setRows(await readTrash());await onChanged()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <section className="panel trash-panel"><div className="panel-heading"><div><h2>Lixeira</h2><p>Recupere demandas, compromissos, encaminhamentos e arquivos excluídos. Recupere primeiro o registro principal.</p></div><button className="secondary" onClick={load} disabled={busy}>{busy?'Aguarde…':rows?'Atualizar lixeira':'Abrir lixeira'}</button></div>{error&&<p role="alert" className="error-box">{error}</p>}{rows?.length===0&&<p className="form-help">A lixeira está vazia.</p>}{rows?.map(r=><article className="trash-row" key={r.kind+r.id}><div><small>{labels[r.kind]} · {stamp(r.deletedAt)}</small><strong>{r.title}</strong><small>Excluído por {r.actor}</small></div><button className="secondary" disabled={busy} onClick={()=>restore(r)}>Recuperar</button></article>)}</section>
}
