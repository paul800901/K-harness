import React,{useEffect,useState} from 'react';
import {Folder,ArrowUp,ChevronRight} from 'lucide-react';
import './workspace.css';

export const sameWorkspace=(a,b)=>String(a??'').replaceAll('\\','/').replace(/\/+$/,'').toLowerCase()===String(b??'').replaceAll('\\','/').replace(/\/+$/,'').toLowerCase();
export const workspaceName=p=>String(p??'').replace(/[\\/]+$/,'').split(/[\\/]/).at(-1)||'選擇工作區';

export function WorkspacePicker({workspace,projects=[],onSelect}){
 const [location,setLocation]=useState(workspace??'D:\\K-harness'),[listing,setListing]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function browse(value){
  setBusy(true);setError('');try{const r=await fetch(`/api/directories?path=${encodeURIComponent(value)}`);const data=await r.json();if(!r.ok)throw Error(data.error);setListing(data);setLocation(data.path);}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 useEffect(()=>{void browse(workspace??'D:\\K-harness');},[]);
 const recent=projects.map(p=>p.path);
 return <div className="workspace-picker">
  <p className="modal-description">選擇專案的主要資料夾，子資料夾不必逐一加入。每個專案可建立多個對話；加入清單不會移動檔案，也不會變更目前對話的工作區或權限。</p>
  <form className="workspace-location" onSubmit={e=>{e.preventDefault();void browse(location);}}><input aria-label="工作區資料夾路徑" value={location} onChange={e=>setLocation(e.target.value)}/><button type="submit" disabled={busy}>前往</button></form>
  {error&&<p role="alert">{error}</p>}
  <div className="workspace-browser"><button type="button" disabled={busy||!listing||sameWorkspace(listing.path,listing.parent)} onClick={()=>browse(listing.parent)}><ArrowUp size={16}/>上一層</button>{listing?.folders.map(f=><button key={f.path} type="button" disabled={busy} onClick={()=>browse(f.path)}><Folder size={17}/><span>{f.name}</span><ChevronRight size={15}/></button>)}{listing&&!listing.folders.length&&<p className="muted">沒有子資料夾，仍可選取此位置。</p>}</div>
  {recent.length>0&&<><p className="muted">已加入的專案</p><div className="recent-workspaces">{recent.map(p=><button type="button" key={p} disabled={busy} title={p} onClick={()=>browse(p)}><Folder size={15}/>{workspaceName(p)}</button>)}</div></>}
  <div className="modal-actions"><button className="primary" disabled={busy||!listing||!sameWorkspace(location,listing.path)} onClick={async()=>{setBusy(true);setError('');try{await onSelect(listing.path);}catch(e){setError(e.message);}finally{setBusy(false);}}}>加入專案</button></div>
 </div>;
}
