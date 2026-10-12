import {createUnifiedController} from './unified-controller.mjs';
import {conversationPreview} from '../shared/conversation-preview.mjs';
import {listMainSessions} from './main-sessions.mjs';
import {deleteArchived} from './archive-delete.mjs';
import {createCompletionAttention} from './completion-attention.mjs';
import {createDiscussionController} from './discussion-controller.mjs';
import {sessionAttachment,messageAttachment} from './session-workspace.mjs';
import {readPresentedFile} from './desktop-files.mjs';
import {readNativeMessageFile} from './native-message-file.mjs';
import {discussionTranscript} from '../shared/discussion.mjs';
import {abortable} from './abortable.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {atomicWrite} from './atomic-write.mjs';

// A native controller owns ONE conversation and its queue. Selecting a different
// conversation changes the projection, not the lifetime of that native work.
export function createConversationController({root,onChange=()=>{},sessionFactory=createUnifiedController,discussionFactory=createDiscussionController,discussionSessionFactory,discussionApi,discussionOptions={},browserRequest,...options}){
 const rooms=new Map(),controllers=new Set(),locked=new Set();
 const continuations=new Map(),continuationTasks=new Set(),continuationStates=new Map();
 const continuationFile=id=>{if(!/^[A-Za-z0-9_-]{1,128}$/u.test(id??''))throw Error('Invalid continuation room.');return path.join(root,'.runtime/chat-continuations',`${id}.json`);};
 const readContinuation=async id=>{try{return JSON.parse(await readFile(continuationFile(id),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const writeContinuation=receipt=>atomicWrite(continuationFile(receipt.sourceThreadId),JSON.stringify(receipt,null,2));
 const attention=createCompletionAttention();
 const discussions=new Map();
 const discussion=controller=>discussions.get(controller.state.threadId);
 const projected=controller=>{const s=controller.state,d=discussion(controller),ds=d?.state,continuation=continuationStates.get(controller);return {...s,...(continuation?{continuation,...(['uncertain','cancelled'].includes(continuation.status)?{error:s.error??continuation.error}:{})}:{}),messages:d?d.project(s.messages??[]):s.messages,discussion:ds,
  ...(d?.busy?{busy:true,status:ds.status==='stopping'?'stopping':'working'}:{})};};
 const loadDiscussion=async (controller,state=controller.state)=>{
  const id=state.threadId;if(!id||discussions.has(id))return;
  const d=discussionFactory({root,threadId:id,executable:options.executable,...discussionOptions,...(discussionSessionFactory?{sessionFactory:discussionSessionFactory}:{}),onChange(){attention.observe(projected(rooms.get(id)??controller));onChange();}});
  await d.load();discussions.set(id,d);
 };
 const noDiscussion=controller=>{if(discussion(controller)?.busy||discussion(controller)?.held)throw Error('請先結束或查明這個聊天室的討論，再變更一般工作設定。');};
 const openedOrder=new Map();let openSequence=0;
 let pendingOpen,pendingView,navigationRequest=0;
 let active,navigating=false,closing=false,sharedUsage=null,navigationSettled=Promise.resolve(),finishNavigation,releasing=Promise.resolve(),idleProbe;
 const create=()=>{
  let controller;
  controller=sessionFactory({...options,root,onContinueConversation:data=>requestContinuation(controller,data),onConversationSettled:data=>{
   const task=finishContinuation(controller,data);continuationTasks.add(task);void task.finally(()=>continuationTasks.delete(task));
  },onChange:()=>{if(!closing){if(controller)attention.observe(projected(controller));onChange();}}});
  controllers.add(controller);return controller;
 };
 const catalog=create();active=catalog;
 const activity=controller=>{const s=projected(controller);return {threadId:s.threadId,workspace:s.workspace,busy:!!s.busy,status:s.status,pendingQuestions:s.questions?.length??0};};
 // Project the existing live owners, never saved history or only the selected room.
 const workerActivity=()=>{
  let running=0,uncertain=false,unconfirmed=0,historicalUnconfirmed=0;
  for(const controller of controllers){
   const s=controller.state;if(!s.threadId)continue;
   const disconnected=['offline','error','uncertain'].includes(s.status)||s.workerConnection==='failed';
   uncertain||=disconnected;
   for(const worker of s.workers??[]){
    if(worker.kind==='command'||worker.settled===true||worker.settled!==false&&['completed','failed','cancelled','canceled','stopped','interrupted'].includes(worker.status))continue;
    if(worker.executionUnowned===true){if(!worker.reconciliation?.reviewedAt)historicalUnconfirmed++;continue;}
    if(disconnected||!['running','starting','pending'].includes(worker.status)){unconfirmed++;uncertain=true;}
    else if(worker.status==='running')running++;
   }
  }
  return {running,uncertain,unconfirmed,...(historicalUnconfirmed?{historicalUnconfirmed}:{})};
 };
 const workerDetails=()=>[...controllers].flatMap(controller=>{
  const s=controller.state;
  if(!s.threadId)return [];
  const disconnected=['offline','error','uncertain'].includes(s.status)||s.workerConnection==='failed';
  const summary=value=>typeof value==='string'?value.split(/\r?\n/u,1)[0].trim().slice(0,240):undefined;
  const safeError=value=>typeof value==='string'?value.slice(0,500):undefined;
  return (s.workers??[]).filter(worker=>worker.kind!=='command').map(worker=>{
    const nativeThreadId=worker.threadId;
    const activityTool=(s.tools??[]).find(tool=>
     nativeThreadId&&((tool.id===`native:${nativeThreadId}`||tool.details?.threadId===nativeThreadId)||tool.details?.threadIds?.includes?.(nativeThreadId)));
    const question=nativeThreadId?(s.questions??[]).find(item=>item.isSubagent&&item.threadId===nativeThreadId):null;
    const ended=worker.settled===true||worker.settled!==false&&['completed','failed','cancelled','canceled','stopped','interrupted'].includes(worker.status);
    const unresolved=!ended&&(disconnected||!['running','starting','pending'].includes(worker.status));
    return {
     requestId:worker.requestId,threadId:nativeThreadId,conversationId:s.threadId,
     conversationTitle:s.title||'未命名聊天室',conversationProvider:s.provider,
     provider:worker.provider,model:worker.model??activityTool?.details?.model,
     task:summary(worker.agentNickname??worker.name??worker.task??activityTool?.details?.description??activityTool?.details?.task??activityTool?.details?.path),
     agentNickname:summary(worker.agentNickname),name:summary(worker.name),
     status:unresolved?'unresolved':worker.status??(ended?'ended':'unknown'),
     settled:worker.settled===true||ended,
     ...(worker.executionUnowned===true?{executionUnowned:true}:{}),
     ...(worker.reconciliation?{reconciliation:worker.reconciliation}:{}),
     lastActivityAt:worker.lastActivityAt??worker.activity?.lastEventAt,lastReadAt:worker.lastReadAt??worker.readAt,
     activity:worker.activity,startedAt:worker.startedAt,inspection:worker.inspection,lastToolName:worker.lastToolName??worker.activity?.lastToolName,
     error:safeError(worker.error)??safeError(activityTool?.error),
     confirmationReason:summary(question?.title??question?.text??(worker.waitingForApproval?'原生工具等待核准':undefined)),
     workerConnection:s.workerConnection,
    };
   });
 });
 const target=data=>{
  if(closing)throw Error('K 正在關閉。');
  const controller=typeof data?.threadId==='string'?rooms.get(data.threadId):null;
  if(!controller)throw Error('請指定已開啟的聊天室；未送出操作。');
  if(locked.has(controller))throw Error('此聊天室正在重新連線或建立分支，請稍候。');
  if(idleProbe?.controller===controller)idleProbe.abort.abort(new DOMException('已讓路給聊天室操作。','AbortError'));
  return controller;
 };
 const focusLock=()=>{if(closing||navigating)throw Error('正在切換聊天室，請稍候。');navigating=true;navigationSettled=new Promise(resolve=>{finishNavigation=resolve;});};
 const focusDone=()=>{navigating=false;finishNavigation?.();onChange();};
 const reindex=(controller,previousId)=>{
  if(previousId&&rooms.get(previousId)===controller&&previousId!==controller.state.threadId)rooms.delete(previousId);
  if(controller.state.threadId){rooms.set(controller.state.threadId,controller);openedOrder.set(controller,++openSequence);}
 };
 const workerRows=async controller=>{
  const result=await controller.workers();return Array.isArray(result)?result:result?.workers??[];
 };
 const continuationNotice=(controller,receipt)=>{
  continuationStates.set(controller,{...receipt,nextInstruction:undefined});
  onChange();
 };
 const cancelContinuation=async(controller,error)=>{
  const pending=continuations.get(controller);if(!pending)return;
  continuations.delete(controller);pending.status='cancelled';pending.error=error;
  continuationNotice(controller,pending);await writeContinuation(pending);
 };
 async function requestContinuation(controller,{threadId,turnId,nextInstruction,stillCurrent,mode='fork'}){
  if(closing||!controller||locked.has(controller)||rooms.get(threadId)!==controller||controller.state.provider!=='codex')throw Error('來源聊天室正在變更或尚未支援此工具。');
  if(typeof nextInstruction!=='string'||!nextInstruction.trim()||nextInstruction.length>16000)throw Error('請提供明確的接續指令，最多 16000 字元。');
  if(!['fork','fresh'].includes(mode))throw Error('未知的換房模式。');
  locked.add(controller);
  try{
  const previous=await readContinuation(threadId);
  if(previous?.turnId===turnId&&previous.kind!=='origin'){
   if((previous.mode??'fork')!==mode)throw Error('同回合換房模式衝突；已受理的模式不變，不建立第二個聊天室。');
   return {...previous,nextInstruction:undefined,created:!!previous.newThreadId};
  }
  const human=controller.state.messages?.find(m=>m.role==='user'&&m.turnId===turnId&&['local','native','steer'].includes(m.source));
  if(!human)throw Error('換房需要本回合的真人訊息；背景通知或程式接續不能自行換房。');
  if(previous?.kind==='origin'){
   if(!previous.initialTurnId||turnId===previous.initialTurnId)throw Error('接續的第一回合不能再次換房；須有新的真人訊息。');
  }else if(previous&&['pending','creating','created','uncertain'].includes(previous.status))throw Error(`前次換房結果尚未確認${previous.newThreadId?`（新聊天室 ${previous.newThreadId}）`:''}；不能重建或重送。`);
  noDiscussion(controller);
  const s=controller.state;
  if(s.threadId!==threadId||!s.busy||s.questions?.length||s.queuedMessages?.length||s.goalPending||s.completionPending)throw Error('原聊天室仍有核准、待送或背景工作；請先查明。');
  const goal=await controller.goal({refresh:true});
  if(goal?.goal?.status==='active'||goal?.goal?.tokenBudget!=null)throw Error('請先暫停原生目標；有預算限制的目標不能用換房重設用量。');
  if((await workerRows(controller)).some(w=>w.settled!==true))throw Error('子代理未確認結束；不能移交或重播。');
  const current=controller.state;
  if(closing||current.threadId!==threadId||!current.busy||current.questions?.length||current.queuedMessages?.length||current.goalPending||current.completionPending)throw Error('來源已變更；未受理換房。');
  const receipt={sourceThreadId:threadId,turnId,mode,status:'pending',nextInstruction:nextInstruction.trim()};
  await writeContinuation(receipt);
  try{
   stillCurrent?.();const latest=controller.state;
   if(closing||latest.threadId!==threadId||!latest.busy||latest.questions?.length||latest.queuedMessages?.length||latest.goalPending||latest.completionPending)throw Error('來源已變更；未受理換房。');
  }catch(error){receipt.status='cancelled';receipt.error=error.message;await writeContinuation(receipt);continuationNotice(controller,receipt);throw error;}
  // No await between the final live check and registration: completion cannot be lost.
  continuations.set(controller,receipt);continuationNotice(controller,receipt);
  return {accepted:true,mode,created:false,started:false,sourceThreadId:threadId,afterTurnId:turnId,action:'End this turn normally. Do not perform more work or call again.'};
  }finally{locked.delete(controller);}
 }
 async function finishContinuation(controller,{threadId,turnId,status}){
  const receipt=continuations.get(controller);
  if(!receipt||receipt.sourceThreadId!==threadId||receipt.turnId!==turnId)return;
  // Consume before any await. Completion notifications cannot create twice.
  continuations.delete(controller);
  let child,openingChild=false;
  try{
   if(closing||status!=='completed'||locked.has(controller)||controller.state.busy||controller.state.questions?.length||controller.state.queuedMessages?.length)throw Error('來源回合已停止、失敗或收到新工作；換房已取消，未重送。');
   locked.add(controller);noDiscussion(controller);
   receipt.status='creating';await writeContinuation(receipt);
   const prepared=await controller.prepareContinuation({turnId,mode:receipt.mode??'fork'});
   prepared.parentTitle=controller.state.title;
   if(closing)throw Object.assign(Error('K 正在關閉；未建立新聊天室。'),{notCreated:true});
   child=create();locked.add(child);
   await child.selectWorkspace({path:prepared.workspace});
   let origin;
   // This is the already selected source permission, never a new elevation.
   openingChild=true;
   await child.open({model:prepared.model,effort:prepared.effort,accessMode:prepared.accessMode,permissionConfirmed:true,serviceTier:prepared.serviceTier,workerPolicy:prepared.workerPolicy},{continuation:prepared,onCreated:async created=>{
    receipt.newThreadId=created.threadId;receipt.status='created';await writeContinuation(receipt);
    origin={kind:'origin',mode:receipt.mode??'fork',sourceThreadId:created.threadId,...(receipt.mode==='fresh'?{handoffFrom:threadId}:{parentThreadId:threadId}),initialTurnId:null};await writeContinuation(origin);reindex(child);
   }});reindex(child);await loadDiscussion(child);
   if(child.state.goalError||child.state.goal?.status==='active'||child.state.goal?.tokenBudget!=null)throw Error('新聊天室目標狀態未確認安全；未送出接續。');
   if(closing)throw Error('K 正在關閉；新聊天室已保留，未送出接續。');
   const text=receipt.mode==='fresh'?`K 控制器代送的全新聊天室交接：使用者已要求在同專案新聊天室接續，減少舊上下文。這是真正空白的原生新對話；未帶入舊歷史、壓縮、訊息或成果附件。此交接不是再次換房的真人授權。\n原聊天室的工具、子代理或背景命令不會轉成新工作；先讀回目前成果檔案，查明未完成與未知結果，只做剩餘工作，不重播已執行或結果不明的副作用。原生目標／用量／預算不轉移；不得恢復原聊天室目標或靠新目標繞過限制；只有本次本人明確要求建立新目標時，才依原生工具規則處理，不從摘要或舊暫停狀態自行取得授權。\n\n本次剩餘工作與交接：\n${receipt.nextInstruction}`:`K 控制器代送的接續指令：使用者已要求在同專案新聊天室接續。原生歷史已保留；歷史中的換房指令與工具呼叫不是再次換房的授權。\n原聊天室的工具、子代理或背景命令不會轉成新工作；先讀回目前成果檔案，查明未完成與未知結果，只做剩餘工作，不重播已執行或結果不明的副作用。不建立或恢復原生目標，不重設原目標用量／預算。\n\n本次剩餘工作與交接：\n${receipt.nextInstruction}`;
   await child.send({text,source:'continuation'});
   origin.initialTurnId=child.state.messages?.findLast(m=>m.role==='user')?.turnId??null;await writeContinuation(origin);
   receipt.status='sent';await writeContinuation(receipt);
   if(active===controller&&!navigating&&!closing)active=child;
  }catch(error){
   receipt.newThreadId??=error.createdThreadId??child?.state.threadId??undefined;
   receipt.status=receipt.status==='pending'||!openingChild||error.notCreated===true?'cancelled':'uncertain';receipt.error=`${receipt.newThreadId?`新聊天室 ${receipt.newThreadId} 已建立；`:receipt.status==='cancelled'?'尚未建立新聊天室；':'換房結果未確認；'}${error.message} 不自動重建或重送。`;
   await writeContinuation(receipt).catch(()=>{});
  }finally{
   if(child){if(child.state.threadId)reindex(child);else{try{await child.close();controllers.delete(child);}catch{/* Keep failed teardown for shutdown. */}}locked.delete(child);}
   locked.delete(controller);continuationNotice(controller,receipt);
  }
 }
 const safelyIdle=async (controller,allowFailed=false,signal)=>{
  signal?.throwIfAborted();
  const read=value=>abortable(value,signal);
  if(discussion(controller)?.busy||discussion(controller)?.held)return false;
  const idleStatuses=allowFailed?['ready','completed','interrupted','failed']:['ready','completed','interrupted'];
  const s=controller.state;
  if(!s.threadId||s.busy||s.goalPending||(s.capabilities?.goalContinuesWhileIdle&&(s.goalError||['active','unknown'].includes(s.goal?.status)))||s.questions?.length||s.queuedMessages?.length||
     !idleStatuses.includes(s.status)||s.workerConnection==='failed'||
     ['offline','error','uncertain','connecting','working'].includes(s.status))return false;
  // Release runtime resources, never the saved room. Adapters persist prepared
  // rooms independently of native history before the first submission.
  if(!(await read(listMainSessions(root))).sessions.some(row=>row.threadId===s.threadId))return false;
  const workers=await read(workerRows(controller));
  if(workers.some(row=>row.settled===false||['running','starting','pending','unresolved'].includes(row.status)||
    (row.settled!==true&&!['completed','failed','cancelled','canceled','stopped','interrupted'].includes(row.status))))return false;
  if(s.browserAccess?.enabled){
   // A registered external gateway with no selected mode has never started a
   // browser. Do not confuse that idle state with lost/unavailable control.
   const browser=await read(browserRequest(root,s,s.threadId,'/state'));
   const notStarted=browser?.external===true&&browser.browserMode===null;
   if(browser?.mode!=='ai'||browser?.busy!==false||(!notStarted&&browser?.available!==true)||browser?.recoveryRequired===true)return false;
  }
  const finalWorkers=await read(workerRows(controller)),latest=controller.state;
  return !discussion(controller)?.busy&&!discussion(controller)?.held&&!latest.busy&&!latest.goalPending&&!(latest.capabilities?.goalContinuesWhileIdle&&(latest.goalError||['active','unknown'].includes(latest.goal?.status)))&&!latest.questions?.length&&!latest.queuedMessages?.length&&
   idleStatuses.includes(latest.status)&&latest.workerConnection!=='failed'&&
   !finalWorkers.some(row=>row.settled===false||['running','starting','pending','unresolved'].includes(row.status)||
    (row.settled!==true&&!['completed','failed','cancelled','canceled','stopped','interrupted'].includes(row.status)));
 };
 const releaseIdleRooms=async()=>{
  const ordered=[...rooms.values()].filter(controller=>controller!==active)
   .sort((a,b)=>(openedOrder.get(b)??0)-(openedOrder.get(a)??0));
  // Keep the active controller plus the three most recently opened hidden
  // controllers available. Protected/busy rooms may make the pool larger.
  for(const controller of ordered.slice(3)){
   if(closing||navigating||controller===active||locked.has(controller)||continuations.has(controller))continue;
   const probe=new AbortController(),request=navigationRequest;idleProbe={controller,abort:probe};let held=false;
   try{
    // Optional read-only checks never lock navigation. A selection cancels our
    // wait, not the underlying read; late results cannot reach close().
    if(!await safelyIdle(controller,false,probe.signal)||probe.signal.aborted||!controllers.has(controller)||closing||navigating||controller===active||request!==navigationRequest||locked.has(controller)||continuations.has(controller))continue;
    idleProbe=null;locked.add(controller);held=true;
    const id=controller.state.threadId;
    await controller.close();
    // A pure view selection may have arrived while close was already running.
    // Keep its owner visible; a later open can resume the now-offline room.
    if(controller!==active){
     if(rooms.get(id)===controller)rooms.delete(id);
     controllers.delete(controller);openedOrder.delete(controller);
    }
   }catch{/* Keep failed or uncertain teardown registered for shutdown retry. */}
   finally{if(idleProbe?.abort===probe)idleProbe=null;if(held)locked.delete(controller);}
  }
 };
 const api={
  concurrentConversations:true,
  get discussionBusy(){return locked.size>0||[...discussions.values()].some(d=>d.busy||d.held);},
  get state(){const s=projected(active),view=pendingView?conversationPreview(pendingView.record,pendingView.history):null;return {...s,...view,connectionOpening:!!pendingView,usage:{...s.usage,...sharedUsage},conversationActivity:[...rooms.values()].map(activity),workerActivity:workerActivity(),workerDetails:workerDetails(),completionAttention:attention.state};},
  markViewed(data){const changed=attention.markViewed(data);if(changed)onChange();return {viewed:changed};},
  async sessions(){const result=await listMainSessions(root);return {...result,sessions:result.sessions.map(row=>{const controller=rooms.get(row.threadId);return controller?{...row,...activity(controller),title:controller.state.title??row.title,model:controller.state.model}:row;})};},
  models:()=>catalog.models(),
  async usage(refresh=false){sharedUsage=await catalog.usage(refresh);onChange();return api.state.usage;},
  async open(data={}){
   if(closing)throw Error('K 正在關閉。');
   if(navigating&&!pendingOpen)throw Error('正在更新聊天室，請稍候。');
   const request=++navigationRequest;
   idleProbe?.abort.abort(new DOMException('已讓路給聊天室切換。','AbortError'));
   pendingView={record:data};onChange();
   // A new selection supersedes the view, not another room's native work.
   // Let an accepted opening settle and retain its owner before opening the latest target.
   if(pendingOpen)await navigationSettled;
   if(request!==navigationRequest)return {superseded:true};
   try{focusLock();}catch(error){if(request===navigationRequest){pendingView=null;onChange();}throw error;}
   const abort=new AbortController();pendingOpen=abort;let candidate,existing;
   const showHistory=async history=>{
    abort.signal.throwIfAborted();
    if(request!==navigationRequest)return;
    await loadDiscussion(candidate??existing,history);abort.signal.throwIfAborted();
    if(request===navigationRequest){const d=discussions.get(history.threadId);pendingView={record:pendingView.record,history:{...history,messages:d?d.project(history.messages??[]):history.messages}};onChange();}
   };
   try{
    const saved=data.threadId?(await listMainSessions(root,{threadId:data.threadId})).sessions[0]:null;
    if(data.threadId&&!saved)throw Error('只能開啟 K 清單中的對話。');
    if(saved&&saved.model!==data.model)throw Error('對話設定已更新，請重新整理清單。');
    if(request===navigationRequest){pendingView={record:saved??data};onChange();}
    existing=data.threadId?rooms.get(data.threadId):null;
    if(existing){
     const s=existing.state;
     const configure=['accessMode','effort','workerPolicy'].some(key=>data[key]!==undefined);
     if(locked.has(existing)){
      if(configure)throw Error('此聊天室正在更新，請稍候。');
      // Viewing an owned room needs no native reopen or mutation. Operations
      // still go through target() and retain the existing lock.
      if(request===navigationRequest)active=existing;openedOrder.set(existing,++openSequence);
      return {threadId:s.threadId,...(request!==navigationRequest?{superseded:true}:{})};
     }
     let recover=s.workerConnection==='failed'||['offline','error','uncertain'].includes(s.status);
     if(s.browserAccess?.enabled&&!s.busy&&!s.questions?.length){
      try{recover||=(await browserRequest(root,s,s.threadId,'/state')).recoveryRequired===true;}catch{/* Missing browser endpoint alone is not proof of a failed native host. */}
     }
     if(configure||recover)noDiscussion(existing);
     if((recover||configure)&&!s.busy&&!s.questions?.length){
      locked.add(existing);try{await showHistory(projected(existing));await existing.open(data,{signal:abort.signal,onHistory:showHistory});abort.signal.throwIfAborted();}finally{locked.delete(existing);}
     }else if(configure)throw Error('此聊天室仍在處理，不能同時變更執行設定。');
    abort.signal.throwIfAborted();if(request===navigationRequest)active=existing;openedOrder.set(existing,++openSequence);releasing=releasing.then(releaseIdleRooms);return {threadId:s.threadId,...(request!==navigationRequest?{superseded:true}:{})};
    }
    abort.signal.throwIfAborted();candidate=create();
    await candidate.selectWorkspace({path:saved?.workspace??data.workspace??active.state.workspace??root});
    abort.signal.throwIfAborted();const result=await candidate.open(data,{signal:abort.signal,onHistory:showHistory});abort.signal.throwIfAborted();
    if(!candidate.state.threadId)throw Error('原生對話尚未建立，未切換聊天室。');
    reindex(candidate);await loadDiscussion(candidate);
    const receipt=candidate.state.provider==='codex'?await readContinuation(candidate.state.threadId):null;
    if(receipt&&receipt.kind!=='origin'){if(['pending','creating','created'].includes(receipt.status)){receipt.status=receipt.status==='pending'?'cancelled':'uncertain';receipt.error='前次換房在程式關閉前未確認完成；不自動建立或重送。';await writeContinuation(receipt);}continuationNotice(candidate,receipt);}
    if(request===navigationRequest)active=candidate;releasing=releasing.then(releaseIdleRooms);return request===navigationRequest?result:{...result,superseded:true};
   }catch(error){
    if(candidate){try{await candidate.close();controllers.delete(candidate);}catch{/* Retain failed teardown for explicit backend shutdown. */}}
    throw error;
   }finally{pendingOpen=null;if(request===navigationRequest)pendingView=null;focusDone();}
  },
  async selectWorkspace(data){
   // Workspace selection only prepares an empty view; it never repurposes a
   // controller that still owns a conversation, approvals, workers or a queue.
   focusLock();const candidate=create();
   try{const result=await candidate.selectWorkspace(data);const old=active;if(old!==catalog&&!old.state.threadId){await old.close();controllers.delete(old);}active=candidate;return result;}
   catch(error){await candidate.close().catch(()=>{});controllers.delete(candidate);throw error;}
   finally{focusDone();}
  },
  async fork(data){
   focusLock();let controller,previousId;
   try{
    controller=target(data);previousId=controller.state.threadId;
    noDiscussion(controller);
    if(discussion(controller)?.messages.some(m=>m.id===data.messageId))throw Error('這則是共用討論紀錄，不是單一原生分支點；請從一般回覆建立分支。');
    if(controller!==active)throw Error('請先切回要分支的聊天室。');
    locked.add(controller);
    // Native fork requires a settled source. The existing adapter enforces that
    // invariant and never interrupts a background conversation to create it.
    return await controller.fork(data);
   }finally{
    if(controller){reindex(controller,previousId);locked.delete(controller);}
    focusDone();
   }
  },
  async metadata(data){
   focusLock();try{const controller=rooms.get(data.threadId)??active;if(data.archived)noDiscussion(controller);const result=await controller.metadata(data);if(data.archived)attention.forget(data.threadId);return result;}finally{focusDone();}
  },
  async moveWorkspace(data){
   focusLock();let controller;
   try{
    const saved=(await listMainSessions(root,{threadId:data.threadId})).sessions.find(s=>s.threadId===data.threadId&&!s.archived);
    if(!saved)throw Error('請指定清單中未封存的聊天室。');
    controller=rooms.get(data.threadId);
    if(controller&&locked.has(controller))throw Error('此聊天室正在更新，請稍候。');
    if(!controller){controller=create();try{await controller.selectWorkspace({path:saved.workspace});await controller.open({threadId:saved.threadId,model:saved.model});reindex(controller);}catch(error){try{await controller.close();controllers.delete(controller);}catch{/* Keep failed teardown registered for explicit shutdown. */}throw error;}}
    locked.add(controller);
    noDiscussion(controller);
    if(!await safelyIdle(controller,true))throw Error('聊天室仍有工作、待送訊息或瀏覽器接手，請先結束再移動。');
    const result=await controller.moveWorkspace(data);active=controller;openedOrder.set(controller,++openSequence);return result;
   }finally{if(controller)locked.delete(controller);focusDone();}
  },
  async deleteArchived(data={}){
   focusLock();const held=[];
   try{
    if(data.confirmed!==true)throw Error('必須明確確認刪除。');
    if(!Array.isArray(data.threadIds)||!data.threadIds.length||data.threadIds.length>500||new Set(data.threadIds).size!==data.threadIds.length||data.threadIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)))throw Error('請指定互不重複的有效聊天室 ID。');
    const saved=(await listMainSessions(root)).sessions;
    for(const id of data.threadIds??[]){
     const controller=rooms.get(id);
     if(!controller||controller===active||!saved.find(row=>row.threadId===id)?.archived)continue;
     const s=controller.state;
     noDiscussion(controller);
     if(s.busy||s.questions?.length||s.queuedMessages?.length||locked.has(controller))throw Error('背景聊天室仍有工作、待確認或待送訊息，不能刪除。');
     locked.add(controller);held.push(controller);
     const workers=await controller.workers();
     const rows=Array.isArray(workers)?workers:workers?.workers??[];
     if(controller.state.busy||rows.some(row=>row.settled===false||['running','starting','pending','unresolved'].includes(row.status)))throw Error('背景子代理工作尚未結束，不能刪除。');
     await controller.close();rooms.delete(id);controllers.delete(controller);
    }
    const result=await deleteArchived({root,threadIds:data.threadIds,confirmed:data.confirmed,currentThreadId:active.state.threadId});for(const id of result.deletedIds)discussions.delete(id);return result;
   }finally{for(const controller of held)locked.delete(controller);focusDone();}
  },
  directories(parent){return active.directories(parent);},
  attachmentFile(id,context){return target(context).attachmentFile(id);},
  attachmentSource(id,context){return target(context).attachmentSource(id,context);},
  artifact(name,context){return target(context).artifact(name);},
  messageFile(href,context){return readNativeMessageFile(projected(target(context)),href);},
  async close(){
   closing=true;++navigationRequest;pendingView=null;
   idleProbe?.abort.abort(new DOMException('K 正在關閉。','AbortError'));
    for(const controller of continuations.keys())await cancelContinuation(controller,'K 已關閉，未建立接續聊天室。').catch(()=>{});
   await Promise.all([...continuationTasks]);
   // A controller still opening may create its native host after close() runs.
   // Settle that already accepted navigation before collecting every owner.
   pendingOpen?.abort(new DOMException('已取消連線。','AbortError'));
   await navigationSettled;
   await releasing;
   const stopped=await Promise.allSettled([...discussions.values()].map(d=>d.close()));
   if(stopped.some(result=>result.status==='rejected')){closing=false;throw Error('部分討論未確認關閉，原生聊天室尚未關閉。');}
   const results=await Promise.allSettled([...controllers].map(controller=>controller.close()));
   const failed=results.filter(result=>result.status==='rejected');
   if(failed.length){closing=false;throw new AggregateError(failed.map(result=>result.reason),'部分聊天室尚未確認關閉，請查明後再試。');}
   rooms.clear();controllers.clear();
  },
 };
 api.discussionStart=async data=>{
  const controller=target(data),s=controller.state;
  noDiscussion(controller);
  locked.add(controller);
  try{
  if(!await safelyIdle(controller,true))throw Error('請先結束或查明這個聊天室的原工作、核准與待送訊息，再開始討論。');
  await loadDiscussion(controller);
  const catalog=(await api.models()).models;
  const choose=choice=>{const model=catalog.find(m=>m.model===choice.model&&m.available!==false);if(!model)throw Error('參與模型目前不在可用原生清單，未換模。');
    const effort=choice.effort||model.defaultReasoningEffort||null,efforts=(model.supportedReasoningEfforts??[]).map(x=>typeof x==='string'?x:x.reasoningEffort);
    if(effort&&!efforts.includes(effort))throw Error('參與模型不支援所選推理程度。');return {model:model.model,displayName:model.displayName,effort,...(model.nativeModels?{nativeModels:model.nativeModels}:{})};};
  if(!Array.isArray(data.participants)||data.participants.length<2)throw Error('請選擇至少兩個參與者。');
  const participants=await Promise.all(data.participants.map(async(p,i)=>{if(p.route&&p.route!=='api')throw Error('討論參與者路線無效。');if(p.route==='api'&&!discussionApi)throw Error('此版本未接通討論 API。');return {...(p.route==='api'?await discussionApi.resolve(p):choose(p)),id:`p${i+1}`};}));
  const facilitator={...choose({model:s.model,effort:s.effort}),id:'host'};
  const source=discussion(controller).project(s.messages??[]);
  const attachments=[],explicit=new Set(data.attachmentIds??[]),ids=new Set([...explicit,...(data.includeContext!==false?source.flatMap(m=>(m.attachments??[]).map(a=>a.id)):[])]);
  for(const id of ids){const a=await (explicit.has(id)?sessionAttachment(s.workspace,s.previousWorkspaces,s.threadId,id):messageAttachment(s,id));if(!a.textPath){if(explicit.has(id))throw Error('討論目前只帶入文字與已擷取文字的文件；圖片／影音請在一般原生對話處理，未假裝已閱讀。');attachments.push({...a,text:null,warning:'本次未帶入原始圖片／影音內容，不能宣稱看過。'});continue;}const content=await readPresentedFile(a.workspace,a.textPath);attachments.push({...a,text:content.bytes.toString('utf8')});}
  return discussion(controller).start({mode:data.mode,text:data.text,participants,facilitator,workspace:s.workspace,source:discussionTranscript(source),attachments,
   reviewTarget:data.reviewTarget??[...source].reverse().find(m=>m.role==='assistant'&&!m.partial&&!m.streaming)?.text,includeContext:data.includeContext!==false,afterMessageId:s.messages?.at(-1)?.id??null});
  }finally{locked.delete(controller);}
 };
 api.discussionMessage=data=>{const c=target(data);if(!discussion(c))throw Error('這個聊天室沒有進行中的討論。');return discussion(c).interject(data);};

 for(const method of ['send','steer','queue','goal','answer','upload','selectModel','review','fuzzyFileSearch'])api[method]=data=>target(data)[method](data);
 for(const method of ['steer','queue','goal','selectModel','review']){const original=api[method];api[method]=data=>{noDiscussion(target(data));return original(data);};}
 api.send=async data=>{
  const c=target(data);noDiscussion(c);await cancelContinuation(c,'收到新的真人訊息，已取消先前換房要求。');continuationStates.delete(c);const d=discussion(c);
  if(!d)return c.send(data);
  locked.add(c);let handoff;
  try{handoff=await d.handoff(data.text);const result=await c.send({...data,text:handoff.text});if(result.sent===false&&!result.queued)await handoff.rejected?.();return result;}
  catch(error){if(error.notSent===true)await handoff?.rejected?.();throw error;}
  finally{locked.delete(c);}
 };
 api.uploadStream=(data,stream)=>target(data).uploadStream(data,stream);
 for(const method of ['compact','workers'])api[method]=data=>target(data)[method]();
 const compact=api.compact;api.compact=data=>{noDiscussion(target(data));return compact(data);};
 api.stop=async data=>{if(data?.cancelOpening===true){++navigationRequest;pendingView=null;idleProbe?.abort.abort(new DOMException('已取消連線。','AbortError'));if(pendingOpen){pendingOpen.abort(new DOMException('已取消連線。','AbortError'));await navigationSettled;}onChange();return {cancelled:true};}const c=target(data);await cancelContinuation(c,'本人停止工作，換房要求已取消。').catch(()=>{});if(discussion(c)?.busy||discussion(c)?.held)return discussion(c).stop();return c.stop();};
 for(const method of ['steer','queue']){const original=api[method];api[method]=async data=>{const c=target(data);await cancelContinuation(c,'收到新的真人訊息，已取消先前換房要求。');continuationStates.delete(c);return original(data);};}
 return api;
}
