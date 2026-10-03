import React,{useState} from 'react';

export function CoreUpdates(){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const update=async provider=>{
  setBusy(true);setNotice('正在確認官方版本並準備更新…');
  try{
   const response=await fetch('/api/core-update',{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:JSON.stringify({provider})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'更新失敗，原核心保持不變。');
   setNotice(result.message);
  }catch(error){setNotice(error.message);}finally{setBusy(false);}
 };
 return <section className="core-updates"><strong>原生核心更新</strong><div className="provider-auth-actions">
  {[['claude','Claude Code'],['codex','Codex'],['gemini','Antigravity']].map(([provider,label])=><button type="button" key={provider} disabled={busy} onClick={()=>update(provider)}>更新 {label}</button>)}
 </div><small>按下才查詢、下載。離開並停止 K 後，重新開啟生效；不影響目前工作。</small>{notice&&<p role="status">{notice}</p>}</section>;
}
