import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {atomicWrite} from './atomic-write.mjs';

const unknown=()=>({status:'unavailable',windows:[],note:'尚未查詢此帳號的官方額度。'});
const clone=value=>structuredClone(value);
const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/u.test(id);

// One native login is shared by all Gemini processes. Settings and project data
// never enter this registry; secrets stay behind the Windows vault adapter.
export function createGeminiAccounts({root,login,vault,enabled=false,clock=Date.now,onChange=()=>{}}){
 const file=path.join(root,'.runtime','gemini-accounts.json');
 let data={version:1,activeAccountId:null,accounts:[],loginPending:null,uncertain:false};
 let changing=false,running=0,refreshPending=null,acquiring=null;
 let loading;
 const load=()=>loading??=(async()=>{try{data=JSON.parse(await readFile(file,'utf8'));if(data.version!==1||!Array.isArray(data.accounts)||data.accounts.some(row=>!validId(row.id)||typeof row.email!=='string'))throw Error('Gemini 帳號紀錄格式不符，未覆寫。');}catch(error){if(error.code!=='ENOENT')throw error;}})();
 const save=async()=>{await atomicWrite(file,JSON.stringify(data,null,2));onChange();};
 const find=id=>data.accounts.find(row=>row.id===id);
 const stamp=()=>new Date(clock()).toISOString();
 const queryAge=row=>clock()-Math.max(Date.parse(row?.lastQueryAt??'')||0,Date.parse(row?.auth?.checkedAt??'')||0);
 const quotaCurrent=row=>['ready','available'].includes(row?.quota?.status)&&queryAge(row)<60000;
 const cachedExhausted=row=>row?.quota?.windows?.some(w=>w.remainingPercent===0&&w.resetsAt*1000>clock());
 const exhausted=row=>quotaCurrent(row)&&row.quota.windows?.some(w=>w.remainingPercent===0&&w.resetsAt*1000>clock());
 function publicRow(row){
  const quota=clone(row.quota??unknown());
  if(quota.windows?.length&&(row.id!==data.activeAccountId||clock()-Date.parse(quota.checkedAt??'')>=60000))quota.status='stale';
  return {id:row.id,email:row.email,auth:clone(row.auth??{status:'unknown'}),quota};
 }
 function snapshot(){return {enabled,activeAccountId:data.activeAccountId,busy:changing||running>0||data.uncertain,checking:!!refreshPending,uncertain:!!data.uncertain,loginPending:!!data.loginPending,accounts:data.accounts.map(publicRow),...(data.uncertain?{reason:'前次 Gemini 程序停止尚未確認；請先停止工作，再刷新確認。'}:{})};}
 const authFailure=row=>row.auth?.status==='signed-out'?'此 Gemini 帳號需重新確認登入，未開始工作。':`${row.auth?.reason??'目前無法確認 Gemini 帳號狀態；尚無證據需要重新登入。'} 未開始工作。`;
 function assertEnabled(){if(!enabled)throw Error('本候選尚未允許真實 Gemini 帳號管理。');}
 async function exclusive(fn,{waitForRefresh=false}={}){
  await load();if(waitForRefresh&&refreshPending)await refreshPending.catch(()=>{});
  if(changing||running)throw Error('Gemini 正在工作或處理登入，請等全部 Gemini 工作停止後再操作。');
  changing=true;onChange();let result;try{result=await fn();}finally{changing=false;onChange();}
  return result?.accounts?{...result,busy:running>0||data.uncertain}:result;
 }
 function requireIdleLogin(){if(data.loginPending)throw Error('請先完成或取消另一帳號的登入。');if(data.uncertain)throw Error('Gemini 程序停止尚未確認，不可切換或再派工作。');}
 async function current(){
  const identity=await vault.current();
  if(identity&&find(identity.accountId)){data.activeAccountId=identity.accountId;return find(identity.accountId);}
  data.activeAccountId=null;return null;
 }
 async function query(row){
  const before=await vault.current();
  if(before?.accountId!==row.id)throw Error('Antigravity 登入已在 K 外變更，未把額度記到原帳號。');
  const result=await login.status();
  const after=await vault.current();
  if(after?.accountId!==row.id){data.activeAccountId=null;await save();throw Error('查詢期間 Antigravity 登入已改變，已丟棄此次額度。');}
  row.lastQueryAt=stamp();
  // A failed quota lookup does not revoke a previously verified identity. Native
  // agy still authenticates each actual turn; keep the original verification time.
  if(!(result.temporaryFailure&&row.auth?.status==='authenticated'))row.auth={status:result.auth?.status??'unknown',checkedAt:result.auth?.checkedAt??stamp(),...(result.auth?.status!=='authenticated'?{reason:result.reason}:{})};
  row.quota=result.quota??{...(row.quota??unknown()),status:row.quota?.windows?.length?'stale':'unavailable',note:result.reason??'此次官方額度查詢未成功。'};
  await save();return result;
 }
 async function activate(id,{restoring=false}={}){
  if(!validId(id)||!find(id))throw Error('Gemini 帳號尚未加入 K。');
  await vault.assertIdle();
  const before=await vault.current();if(before&&!find(before.accountId)&&!restoring)throw Error('目前登入尚未加入 K；請先確認並保存目前登入，未覆寫。');
  const identity=await vault.activate(id,{preserveCurrent:!restoring});
  if(identity.accountId!==id)throw Error('Gemini 切換後身分不符，未開始工作。');
  data.activeAccountId=id;await save();await query(find(id));
 }
 function remember(identity){
  if(!validId(identity?.accountId)||typeof identity.email!=='string')throw Error('無法確認 Gemini 帳號身分，未加入。');
  let row=find(identity.accountId);
  if(!row){row={id:identity.accountId,email:identity.email,auth:{status:'unknown'},quota:unknown()};data.accounts.push(row);}
  data.activeAccountId=row.id;return row;
 }
 const api={
  get cachedUsage(){const rows=data.accounts.map(publicRow),active=rows.find(row=>row.id===data.activeAccountId);return rows.length?{...(active?.quota??unknown()),accountId:active?.id??null,accountEmail:active?.email??null,accounts:rows}:null;},
  async list(){await load();return snapshot();},
  async inspect(fn){await load();if(refreshPending)await refreshPending;requireIdleLogin();if(changing)throw Error('Gemini 正在處理帳號操作。');running++;try{return await fn();}finally{running--;onChange();}},
  async capture(){assertEnabled();return exclusive(async()=>{requireIdleLogin();const row=remember(await vault.capture());await save();await query(row);return snapshot();});},
  async startLogin(){assertEnabled();return exclusive(async()=>{
   requireIdleLogin();await vault.assertIdle();
   // Retain the previous identity before clearing the live slot. The journal is
   // written first so an interrupted browser login still offers explicit restore.
   const existing=await vault.current();if(existing)remember(await vault.capture());
   data.loginPending={previousAccountId:existing?.accountId??null};await save();
   await vault.prepareLogin();data.activeAccountId=null;await save();await login.start();return snapshot();
  });},
  async finishLogin(){assertEnabled();return exclusive(async()=>{
   if(!data.loginPending)throw Error('目前沒有等待完成的 Gemini 登入。');
   const identity=await vault.capture(),row={id:identity.accountId,email:identity.email};
   // Verify before adding a card or marking the new identity as active.
   await query(row);
   if(row.auth.status!=='authenticated')throw Error('尚未確認官方登入成功，請完成登入並關閉官方程式後再試。');
   Object.assign(remember(identity),row);
   data.loginPending=null;await save();return snapshot();
  });},
  async cancelLogin(){assertEnabled();return exclusive(async()=>{
   if(!data.loginPending)return snapshot();await vault.assertIdle();
   const previous=data.loginPending.previousAccountId;
   if(previous)await activate(previous,{restoring:true});else data.activeAccountId=null;
   data.loginPending=null;await save();return snapshot();
  });},
  async activate({accountId}){assertEnabled();return exclusive(async()=>{requireIdleLogin();await activate(accountId);return snapshot();},{waitForRefresh:true});},
  async refresh(){
   await load();if(!data.accounts.length&&!data.loginPending&&!data.uncertain)return snapshot();assertEnabled();
   if(refreshPending)return refreshPending;
   refreshPending=exclusive(async()=>{
    if(data.loginPending)throw Error('登入完成後請按「完成登入」，或取消回原帳號。');
    if(data.uncertain){await vault.assertIdle();data.uncertain=false;await save();}
    const row=await current();if(row)await query(row);else await save();return snapshot();
   });try{return await refreshPending;}finally{refreshPending=null;}
  },
  async usage(refresh=false){
   await load();
   if(!data.accounts.length)return null;
   if(!changing&&!running&&!data.loginPending&&!data.uncertain&&enabled){
    const row=find(data.activeAccountId);
    if(refresh||!row||queryAge(row)>=60000)try{await api.refresh();}catch{/* cached values remain explicitly stale */}
   }
   const rows=data.accounts.map(publicRow),active=rows.find(row=>row.id===data.activeAccountId);
   return {...(active?.quota??unknown()),accountId:active?.id??null,accountEmail:active?.email??null,accounts:rows};
  },
  async acquire({accountId,worker=false,unboundHistory=false}={}){
   // Serialize only startup checks, not execution. Concurrent workers must not
   // mistake another worker's credential check for a human account switch.
   while(acquiring)await acquiring;
   let unlock;acquiring=new Promise(resolve=>{unlock=resolve;});
   try{
   await load();if(refreshPending)await refreshPending;requireIdleLogin();
   if(changing)throw Error('Gemini 正在切換帳號或登入，未開始工作。');
   changing=true;
   let chosen=null;
   try{
    if(data.accounts.length){
     assertEnabled();if(!running)await vault.assertIdle();chosen=await current();
     if(unboundHistory)throw Error('此舊 Gemini 對話沒有帳號綁定，請以新對話交接；未跨帳號讀取原生歷史。');
     if(!chosen&&!accountId)throw Error('目前 Antigravity 登入未加入 K，請先保存目前登入或選擇已加入帳號。');
     let target=accountId??chosen.id;
     if(worker){
      if(!chosen)throw Error('目前 Antigravity 登入未加入 K，未開始工人工作。');
      if(accountId&&!find(accountId))throw Error('Gemini 帳號選擇無效，未開始工作。');
      // Refresh before selecting: either official quota window may require a
      // handoff, but an old/failed lookup must not rotate subscription logins.
      if(!running&&(chosen.auth?.status!=='authenticated'||queryAge(chosen)>=60000))await query(chosen);
      if(chosen.auth?.status!=='authenticated')throw Error(authFailure(chosen));
      if(exhausted(chosen)){
       if(running)throw Error('目前 Gemini 工作尚未結束，不能交接帳號；未送出本工作。');
       const index=data.accounts.findIndex(row=>row.id===chosen.id);
       const next=[...data.accounts.slice(index+1),...data.accounts.slice(0,index)];
       let found=false;
       for(const row of next){
        await activate(row.id);
        chosen=find(row.id);target=row.id;
        if(chosen.auth?.status!=='authenticated')throw Error(authFailure(chosen));
        // A fresh positive official balance is usable even if its last reset
        // timestamp is in the past (for example an unused, full account).
        const available=chosen.quota?.windows?.length>0&&chosen.quota.windows.every(w=>Number.isFinite(w.remainingPercent)&&w.remainingPercent>0);
        if(!quotaCurrent(chosen)||!available&&!exhausted(chosen))throw Error('下一個 Gemini 帳號尚無官方目前額度資料，未開始工作；請刷新確認後再試。');
        if(!exhausted(chosen)){found=true;break;}
       }
       if(!found)throw Error('Gemini 依序帳號皆已無可用額度，未開始工作。');
      }else if(accountId&&accountId!==chosen.id){
       throw Error('目前 Gemini 帳號尚未確認額度耗盡，工人不得跳過順序切換帳號；未送出本工作。');
      }
      if(!quotaCurrent(chosen)&&cachedExhausted(chosen))throw Error('目前帳號的耗盡狀態已過期且無法向官方重新確認，未開始工作或切換帳號。');
     }
     if(target!==chosen?.id){
      const targetRow=find(target);
      if(!targetRow)throw Error('Gemini 帳號選擇無效，未開始工作。');
      if(targetRow.auth?.status==='signed-out')throw Error('此 Gemini 帳號需重新確認登入，未開始工作。');
      if(exhausted(targetRow))throw Error('此 Gemini 帳號官方額度已用完，未開始工作。');
      if(running)throw Error('其他 Gemini 工作尚未結束，不能換帳號；未送出本工作。');
      await activate(target);chosen=find(target);
     }
     if(!chosen||chosen.id!==target)throw Error('Gemini 帳號選擇無效，未開始工作。');
     const authStale=queryAge(chosen)>=60000;
     if(chosen.auth?.status!=='authenticated'){
      if(running)throw Error(authFailure(chosen));
      await query(chosen);
     }else if(authStale&&!running)await query(chosen);
     if(chosen.auth.status!=='authenticated')throw Error(authFailure(chosen));
     if(exhausted(chosen))throw Error('此 Gemini 帳號官方額度已用完，未開始工作。');
    }else if(accountId)throw Error('Gemini 帳號尚未加入 K。');
    running++;
   }finally{changing=false;onChange();}
   let released=false;
   return {accountId:chosen?.id??null,accountEmail:chosen?.email??null,async release({settled=true,refresh=false}={}){
    if(released)return;released=true;running--;if(!settled){data.uncertain=true;await save();}
    onChange();if(refresh&&!running&&!data.uncertain&&chosen)try{await api.refresh();}catch{/* no replay; next status read shows cached quota */}
   }};
   }finally{acquiring=null;unlock();}
  },
  async run(options,fn){const lease=await api.acquire(options);let outcome;try{outcome=await fn(lease);return {...outcome,accountId:lease.accountId,accountEmail:lease.accountEmail};}catch(error){if(error.settled===false)outcome={settled:false};throw error;}finally{await lease.release({settled:outcome?.settled!==false,refresh:true});}},
 };
 return api;
}
