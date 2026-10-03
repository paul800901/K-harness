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
 let changing=false,running=0,refreshPending=null;
 let loading;
 const load=()=>loading??=(async()=>{try{data=JSON.parse(await readFile(file,'utf8'));if(data.version!==1||!Array.isArray(data.accounts)||data.accounts.some(row=>!validId(row.id)||typeof row.email!=='string'))throw Error('Gemini 帳號紀錄格式不符，未覆寫。');}catch(error){if(error.code!=='ENOENT')throw error;}})();
 const save=async()=>{await atomicWrite(file,JSON.stringify(data,null,2));onChange();};
 const find=id=>data.accounts.find(row=>row.id===id);
 const stamp=()=>new Date(clock()).toISOString();
 const exhausted=row=>row?.quota?.windows?.some(w=>w.remainingPercent===0&&w.resetsAt*1000>clock());
 function publicRow(row){
  const quota=clone(row.quota??unknown());
  if(quota.windows?.length&&(row.id!==data.activeAccountId||clock()-Date.parse(quota.checkedAt??'')>=60000))quota.status='stale';
  return {id:row.id,email:row.email,auth:clone(row.auth??{status:'unknown'}),quota};
 }
 function snapshot(){return {enabled,activeAccountId:data.activeAccountId,busy:changing||running>0||data.uncertain,uncertain:!!data.uncertain,loginPending:!!data.loginPending,accounts:data.accounts.map(publicRow),...(data.uncertain?{reason:'前次 Gemini 程序停止尚未確認；請先停止工作，再刷新確認。'}:{})};}
 function assertEnabled(){if(!enabled)throw Error('本候選尚未允許真實 Gemini 帳號管理。');}
 async function exclusive(fn){
  await load();if(changing||running)throw Error('Gemini 正在工作或處理登入，請等全部 Gemini 工作停止後再操作。');
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
  row.auth={status:result.auth?.status??'unknown',checkedAt:result.auth?.checkedAt??stamp()};
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
   const row=remember(await vault.capture());await save();await query(row);
   if(row.auth.status!=='authenticated')throw Error('尚未確認官方登入成功，請完成登入並關閉官方程式後再試。');
   data.loginPending=null;await save();return snapshot();
  });},
  async cancelLogin(){assertEnabled();return exclusive(async()=>{
   if(!data.loginPending)return snapshot();await vault.assertIdle();
   const previous=data.loginPending.previousAccountId;
   if(previous)await activate(previous,{restoring:true});else data.activeAccountId=null;
   data.loginPending=null;await save();return snapshot();
  });},
  async activate({accountId}){assertEnabled();return exclusive(async()=>{requireIdleLogin();await activate(accountId);return snapshot();});},
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
    if(refresh||!row||clock()-(Date.parse(row.auth?.checkedAt??'')||0)>=60000)try{await api.refresh();}catch{/* cached values remain explicitly stale */}
   }
   const rows=data.accounts.map(publicRow),active=rows.find(row=>row.id===data.activeAccountId);
   return {...(active?.quota??unknown()),accountId:active?.id??null,accountEmail:active?.email??null,accounts:rows};
  },
  async acquire({accountId,worker=false,unboundHistory=false}={}){
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
     if(worker&&!accountId&&exhausted(chosen))target=data.accounts.find(row=>row.id!==chosen.id&&row.auth?.status!=='signed-out'&&!exhausted(row))?.id??target;
     if(target!==chosen?.id){
      const targetRow=find(target);
      if(!targetRow)throw Error('Gemini 帳號選擇無效，未開始工作。');
      if(targetRow.auth?.status==='signed-out')throw Error('此 Gemini 帳號需重新確認登入，未開始工作。');
      if(exhausted(targetRow))throw Error('此 Gemini 帳號官方額度已用完，未開始工作。');
      if(running)throw Error('其他 Gemini 工作尚未結束，不能換帳號；未送出本工作。');
      await activate(target);chosen=find(target);
     }
     if(!chosen||chosen.id!==target)throw Error('Gemini 帳號選擇無效，未開始工作。');
     const authStale=clock()-(Date.parse(chosen.auth.checkedAt??'')||0)>=60000;
     if(chosen.auth?.status!=='authenticated'){
      if(running)throw Error('此 Gemini 帳號需重新確認登入，未開始工作。');
      await query(chosen);
     }else if(authStale&&!running)await query(chosen);
     if(chosen.auth.status!=='authenticated')throw Error('此 Gemini 帳號需重新確認登入，未開始工作。');
     if(exhausted(chosen))throw Error('此 Gemini 帳號官方額度已用完，未開始工作。');
    }else if(accountId)throw Error('Gemini 帳號尚未加入 K。');
    running++;
   }finally{changing=false;onChange();}
   let released=false;
   return {accountId:chosen?.id??null,accountEmail:chosen?.email??null,async release({settled=true,refresh=false}={}){
    if(released)return;released=true;running--;if(!settled){data.uncertain=true;await save();}
    onChange();if(refresh&&!running&&!data.uncertain&&chosen)try{await api.refresh();}catch{/* no replay; next status read shows cached quota */}
   }};
  },
  async run(options,fn){const lease=await api.acquire(options);let outcome;try{outcome=await fn(lease);return {...outcome,accountId:lease.accountId,accountEmail:lease.accountEmail};}catch(error){if(error.settled===false)outcome={settled:false};throw error;}finally{await lease.release({settled:outcome?.settled!==false,refresh:true});}},
 };
 return api;
}
