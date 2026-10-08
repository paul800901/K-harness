import {createUnifiedController} from './unified-controller.mjs';
import {conversationPreview} from '../shared/conversation-preview.mjs';
import {listMainSessions} from './main-sessions.mjs';
import {deleteArchived} from './archive-delete.mjs';
import {createCompletionAttention} from './completion-attention.mjs';
import {createDiscussionController} from './discussion-controller.mjs';
import {sessionAttachment} from './session-workspace.mjs';
import {readPresentedFile} from './desktop-files.mjs';
import {discussionTranscript} from '../shared/discussion.mjs';

// A native controller owns ONE conversation and its queue. Selecting a different
// conversation changes the projection, not the lifetime of that native work.
export function createConversationController({root,onChange=()=>{},sessionFactory=createUnifiedController,discussionFactory=createDiscussionController,discussionSessionFactory,discussionOptions={},browserRequest,...options}){
 const rooms=new Map(),controllers=new Set(),locked=new Set();
 const attention=createCompletionAttention();
 const discussions=new Map();
 const discussion=controller=>discussions.get(controller.state.threadId);
 const projected=controller=>{const s=controller.state,d=discussion(controller),ds=d?.state;return {...s,messages:d?d.project(s.messages??[]):s.messages,discussion:ds,
  ...(d?.busy?{busy:true,status:ds.status==='stopping'?'stopping':'working'}:{})};};
 const loadDiscussion=async (controller,state=controller.state)=>{
  const id=state.threadId;if(!id||discussions.has(id))return;
  const d=discussionFactory({root,threadId:id,executable:options.executable,...discussionOptions,...(discussionSessionFactory?{sessionFactory:discussionSessionFactory}:{}),onChange(){attention.observe(projected(rooms.get(id)??controller));onChange();}});
  await d.load();discussions.set(id,d);
 };
 const noDiscussion=controller=>{if(discussion(controller)?.busy||discussion(controller)?.held)throw Error('請先結束或查明這個聊天室的討論，再變更一般工作設定。');};
 const openedOrder=new Map();let openSequence=0;
 let pendingOpen,pendingView,navigationRequest=0;
 let active,navigating=false,closing=false,sharedUsage=null,navigationSettled=Promise.resolve(),finishNavigation,releasing=Promise.resolve();
 const create=()=>{
  let controller;
  controller=sessionFactory({...options,root,onChange:()=>{if(!closing){if(controller)attention.observe(projected(controller));onChange();}}});
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
 const safelyIdle=async (controller,allowFailed=false)=>{
  if(discussion(controller)?.busy||discussion(controller)?.held)return false;
  const idleStatuses=allowFailed?['ready','completed','interrupted','failed']:['ready','completed','interrupted'];
  const s=controller.state;
  if(!s.threadId||s.busy||s.goalPending||(s.capabilities?.goalContinuesWhileIdle&&(s.goalError||['active','unknown'].includes(s.goal?.status)))||s.questions?.length||s.queuedMessages?.length||
     !idleStatuses.includes(s.status)||s.workerConnection==='failed'||
     ['offline','error','uncertain','connecting','working'].includes(s.status))return false;
  // Release runtime resources, never the saved room. Adapters persist prepared
  // rooms independently of native history before the first submission.
  if(!(await listMainSessions(root)).sessions.some(row=>row.threadId===s.threadId))return false;
  const workers=await workerRows(controller);
  if(workers.some(row=>row.settled===false||['running','starting','pending','unresolved'].includes(row.status)||
    (row.settled!==true&&!['completed','failed','cancelled','canceled','stopped','interrupted'].includes(row.status))))return false;
  if(s.browserAccess?.enabled){
   // A registered external gateway with no selected mode has never started a
   // browser. Do not confuse that idle state with lost/unavailable control.
   const browser=await browserRequest(root,s,s.threadId,'/state');
   const notStarted=browser?.external===true&&browser.browserMode===null;
   if(browser?.mode!=='ai'||browser?.busy!==false||(!notStarted&&browser?.available!==true)||browser?.recoveryRequired===true)return false;
  }
  const finalWorkers=await workerRows(controller),latest=controller.state;
  return !latest.busy&&!latest.goalPending&&!(latest.capabilities?.goalContinuesWhileIdle&&(latest.goalError||['active','unknown'].includes(latest.goal?.status)))&&!latest.questions?.length&&!latest.queuedMessages?.length&&
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
   if(locked.has(controller))continue;
   locked.add(controller);
   try{
    if(!await safelyIdle(controller))continue;
    const id=controller.state.threadId;
    await controller.close();
    if(rooms.get(id)===controller)rooms.delete(id);
    controllers.delete(controller);openedOrder.delete(controller);
   }catch{/* Keep failed or uncertain teardown registered for shutdown retry. */}
   finally{locked.delete(controller);}
  }
 };
 const api={
  concurrentConversations:true,
  get state(){const s=projected(active),view=pendingView?conversationPreview(pendingView.record,pendingView.history):null;return {...s,...view,connectionOpening:!!pendingView,usage:{...s.usage,...sharedUsage},conversationActivity:[...rooms.values()].map(activity),workerActivity:workerActivity(),workerDetails:workerDetails(),completionAttention:attention.state};},
  markViewed(data){const changed=attention.markViewed(data);if(changed)onChange();return {viewed:changed};},
  async sessions(){const result=await listMainSessions(root);return {...result,sessions:result.sessions.map(row=>{const controller=rooms.get(row.threadId);return controller?{...row,...activity(controller),title:controller.state.title??row.title,model:controller.state.model}:row;})};},
  models:()=>catalog.models(),
  async usage(refresh=false){sharedUsage=await catalog.usage(refresh);onChange();return api.state.usage;},
  async open(data={}){
   if(closing)throw Error('K 正在關閉。');
   if(navigating&&!pendingOpen)throw Error('正在更新聊天室，請稍候。');
   const request=++navigationRequest;
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
     if(locked.has(existing))throw Error('此聊天室正在更新，請稍候。');
     let recover=s.workerConnection==='failed'||['offline','error','uncertain'].includes(s.status);
     if(s.browserAccess?.enabled&&!s.busy&&!s.questions?.length){
      try{recover||=(await browserRequest(root,s,s.threadId,'/state')).recoveryRequired===true;}catch{/* Missing browser endpoint alone is not proof of a failed native host. */}
     }
     const configure=['accessMode','effort','workerPolicy'].some(key=>data[key]!==undefined);
     if(configure||recover)noDiscussion(existing);
     if((recover||configure)&&!s.busy&&!s.questions?.length){
      locked.add(existing);try{await showHistory(projected(existing));await existing.open(data,{signal:abort.signal,onHistory:showHistory});abort.signal.throwIfAborted();}finally{locked.delete(existing);}
     }else if(configure)throw Error('此聊天室仍在處理，不能同時變更執行設定。');
    abort.signal.throwIfAborted();if(request===navigationRequest)active=existing;openedOrder.set(existing,++openSequence);releasing=releasing.then(releaseIdleRooms);return {threadId:s.threadId};
    }
    abort.signal.throwIfAborted();candidate=create();
    await candidate.selectWorkspace({path:saved?.workspace??data.workspace??active.state.workspace??root});
    abort.signal.throwIfAborted();const result=await candidate.open(data,{signal:abort.signal,onHistory:showHistory});abort.signal.throwIfAborted();
    if(!candidate.state.threadId)throw Error('原生對話尚未建立，未切換聊天室。');
    reindex(candidate);await loadDiscussion(candidate);if(request===navigationRequest)active=candidate;releasing=releasing.then(releaseIdleRooms);return result;
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
  async close(){
   closing=true;++navigationRequest;pendingView=null;
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
  const participants=data.participants.map((p,i)=>({...choose(p),id:`p${i+1}`}));
  const facilitator={...choose({model:s.model,effort:s.effort}),id:'host'};
  const source=discussion(controller).project(s.messages??[]);
  const attachments=[],explicit=new Set(data.attachmentIds??[]),ids=new Set([...explicit,...(data.includeContext!==false?source.flatMap(m=>(m.attachments??[]).map(a=>a.id)):[])]);
  for(const id of ids){const a=await sessionAttachment(s.workspace,s.previousWorkspaces,s.threadId,id);if(!a.textPath){if(explicit.has(id))throw Error('討論目前只帶入文字與已擷取文字的文件；圖片／影音請在一般原生對話處理，未假裝已閱讀。');attachments.push({...a,text:null,warning:'本次未帶入原始圖片／影音內容，不能宣稱看過。'});continue;}const content=await readPresentedFile(a.workspace,a.textPath);attachments.push({...a,text:content.bytes.toString('utf8')});}
  return discussion(controller).start({mode:data.mode,text:data.text,participants,facilitator,workspace:s.workspace,source:discussionTranscript(source),attachments,
   reviewTarget:data.reviewTarget??[...source].reverse().find(m=>m.role==='assistant'&&!m.partial&&!m.streaming)?.text,includeContext:data.includeContext!==false,afterMessageId:s.messages?.at(-1)?.id??null});
  }finally{locked.delete(controller);}
 };
 api.discussionMessage=data=>{const c=target(data);if(!discussion(c))throw Error('這個聊天室沒有進行中的討論。');return discussion(c).interject(data);};

 for(const method of ['send','steer','queue','goal','answer','upload','selectModel','review','fuzzyFileSearch'])api[method]=data=>target(data)[method](data);
 for(const method of ['steer','queue','goal','selectModel','review']){const original=api[method];api[method]=data=>{noDiscussion(target(data));return original(data);};}
 api.send=async data=>{
  const c=target(data);noDiscussion(c);const d=discussion(c);
  if(!d)return c.send(data);
  locked.add(c);let handoff;
  try{handoff=await d.handoff(data.text);const result=await c.send({...data,text:handoff.text});if(result.sent===false&&!result.queued)await handoff.rejected?.();return result;}
  catch(error){if(error.notSent===true)await handoff?.rejected?.();throw error;}
  finally{locked.delete(c);}
 };
 api.uploadStream=(data,stream)=>target(data).uploadStream(data,stream);
 for(const method of ['compact','workers'])api[method]=data=>target(data)[method]();
 const compact=api.compact;api.compact=data=>{noDiscussion(target(data));return compact(data);};
 api.stop=async data=>{if(data?.cancelOpening===true){++navigationRequest;pendingView=null;if(pendingOpen){pendingOpen.abort(new DOMException('已取消連線。','AbortError'));await navigationSettled;}onChange();return {cancelled:true};}const c=target(data);if(discussion(c)?.busy||discussion(c)?.held)return discussion(c).stop();return c.stop();};
 return api;
}
