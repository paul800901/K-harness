import {createWorkActivity,geminiWorkActivity} from './work-activity.mjs';
import {quotaZeroUntil,quotaZeroRecheckDue} from './quota-zero.mjs';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {googleOpsMcp} from './google-ops-mcp.mjs';
import {geminiProjectMcp} from './gemini-project-mcp.mjs';
import {atomicWrite} from './atomic-write.mjs';
import {createGeminiLogin} from './gemini-login.mjs';
import {geminiExecutable,geminiEnvironment,geminiSettings,geminiMcpConfig,geminiStream,geminiProcess,geminiOutcome,killGeminiTree,GEMINI_BROWSER_GUIDANCE,GEMINI_MEDIA_GUIDANCE} from './gemini-worker.mjs';
import {saveMainSession,listMainSessions} from './main-sessions.mjs';
import {validateWorkspace,listWorkspaceDirectories} from './workspaces.mjs';
import {saveAttachment,saveAttachmentStream,readPresentedFile} from './desktop-files.mjs';
import {sessionAttachment,sessionAttachmentSource,sessionArtifact,workspaceGuidance} from './session-workspace.mjs';
import {normalizeWorkerPolicy,MODEL_ROLE_GUIDANCE} from './worker-policy.mjs';
import {browserSessionKey} from './browser-mcp-config.mjs';

const sessionId=id=>typeof id==='string'&&/^gemini-[0-9a-f-]{36}$/iu.test(id);
const nativeId=id=>typeof id==='string'&&/^[0-9a-f-]{36}$/iu.test(id);
const access=value=>{if(!['read-only','workspace-write','danger-full-access'].includes(value))throw Error('Gemini 提供唯讀、工作區編輯或完整存取權；未提供互動核准／自動審查。');return value;};
const now=()=>new Date().toISOString();
const quota={status:'unavailable',windows:[],note:'尚未取得 Antigravity 官方額度。'};
// Native view_file verified on these catalog models; never infer a future model's support.
const mediaModels=new Set(['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.1-pro']);

// Every choice comes from `agy models`, including its supported effort variants.
export function geminiModelsFrom(names){
 const groups=new Map();
 for(const id of names){
  if(!/^gemini-[\w.-]+$/u.test(id))continue;
  const match=id.match(/^(.*)-(low|medium|high|xhigh|max)$/u),model=match?.[1]??id,effort=match?.[2]??null;
  let row=groups.get(model);
  if(!row){row={model,displayName:model.replace(/^gemini-/u,'Gemini ').replaceAll('-',' ').replace(/\b(flash|pro)\b/gu,s=>s[0].toUpperCase()+s.slice(1)),provider:'gemini',available:true,inputModalities:mediaModels.has(model)?['text','image','pdf','audio','video']:['text'],supportedReasoningEfforts:[],defaultReasoningEffort:effort,nativeModels:{}};groups.set(model,row);}
  row.nativeModels[effort??'default']=id;
  if(effort&&!row.supportedReasoningEfforts.some(item=>item.reasoningEffort===effort))row.supportedReasoningEfforts.push({reasoningEffort:effort});
 }
 return [...groups.values()];
}

/** K stores presentation only. agy owns execution, native history and compression. */
export function createGeminiController({root,geminiExecutable:executable,env=process.env,run=geminiProcess,killTree=killGeminiTree,loginFactory=createGeminiLogin,accounts,onChange=()=>{},timeoutMs=0,browserConfig=async()=>null,closeBrowser=async()=>{}}={}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<0)throw Error('Gemini timeoutMs 無效。');
 const login=loginFactory({cwd:root,executable,env}),binary=geminiExecutable(env,executable);
 let usagePending=null,usageAttemptAt=0;
 const state={provider:'gemini',status:'idle',threadId:null,model:null,modelDisplayName:null,inputModalities:['text'],workspace:root,accessMode:'workspace-write',workerPolicy:normalizeWorkerPolicy(),title:'',effort:null,efforts:[],lastUsedModel:null,modelChanges:[],messages:[],tools:[],artifacts:[],workers:[],questions:[],notices:[],reasoning:[],turnDiffs:[],goal:null,busy:false,error:null,browserAccess:{enabled:false,networkAccess:false},capabilities:{steer:false,goal:true,compact:false,fileSearch:false,review:false,turnDiffs:false,reasoningSummary:false,nativeFork:false},progress:{plan:[],explanation:null,compaction:'native',compactions:null,compactionsComplete:false,tokenUsage:null},usage:{gemini:quota}};
 const activity=createWorkActivity(state);
 let record=null,selected=null,opening=false,turn=null,persist=Promise.resolve(),unresolvedPid=null;
 let browserMode=null,browserServer=null;
 async function resetBrowser(){
  if(browserServer)try{await closeBrowser();}catch(error){state.status='uncertain';state.error=`瀏覽器停止尚未確認：${error.message}`;throw error;}
  browserMode=null;browserServer=null;state.browserAccess={enabled:false,networkAccess:false};
 }
 const changed=()=>{try{onChange(state);}catch{}};
 const file=id=>{if(!sessionId(id))throw Error('Gemini 對話 ID 無效。');return path.join(root,'.runtime/gemini-sessions',`${id}.json`);};
 const home=()=>path.join(root,'agent-home','gemini','main',state.threadId);
 const save=()=>{
  if(!record)return Promise.resolve();
  const snapshot=structuredClone({...record,model:state.model,effort:state.effort,title:state.title,workspace:state.workspace,previousWorkspaces:state.previousWorkspaces,previousArtifacts:state.previousArtifacts,accessMode:state.accessMode,goal:state.goal,messages:state.messages,tools:state.tools,artifacts:state.artifacts,lastUsedModel:state.lastUsedModel,modelChanges:state.modelChanges,lastOpenedAt:now()});
  record=snapshot;
  const next=persist.catch(()=>{}).then(async()=>{await atomicWrite(file(snapshot.threadId),JSON.stringify(snapshot,null,2));await saveMainSession(root,snapshot);});persist=next;return next;
 };
 const read=async id=>JSON.parse(await readFile(file(id),'utf8'));
 const idle=()=>{if(state.busy||opening||unresolvedPid)throw Error('請先結束或查明目前 Gemini 工作。');};
 function choose(catalog,model,effort){
  const choice=catalog.find(item=>item.model===model);
  if(!choice)throw Error('目前 agy 未提供指定 Gemini 模型；未換模。');
  const level=effort??choice.defaultReasoningEffort;
  if(!choice.nativeModels[level??'default'])throw Error('指定 Gemini 推理程度目前不可用；未換模。');
  return {choice,level};
 }
 async function prepare(){
  if(!binary)throw Error('找不到 agy，請安裝 Antigravity CLI 並登入。');
  if(browserMode!==state.accessMode){
   await resetBrowser();
   browserServer=state.accessMode==='read-only'?null:await browserConfig({appRoot:root,conversationId:state.threadId,accessMode:state.accessMode,provider:'gemini'});
   browserMode=state.accessMode;
  }
  const temps=Object.entries(env).filter(([key])=>/^(TEMP|TMP)$/iu.test(key)).map(([,value])=>value);
  const googleOps=await googleOpsMcp(state.workspace,{root});
  const projectMcp=await geminiProjectMcp(root,state.workspace,state.accessMode);
  const settings=geminiSettings(state.workspace,state.accessMode,temps,browserServer,googleOps,projectMcp);
  await atomicWrite(path.join(home(),'.gemini/config/mcp_config.json'),JSON.stringify(geminiMcpConfig(browserServer,googleOps,projectMcp),null,2));
  await atomicWrite(path.join(home(),'.gemini/antigravity-cli/settings.json'),JSON.stringify(settings,null,2));
  await atomicWrite(path.join(home(),'.gemini/config/rules/k-model-roles.md'),`---\ntrigger: always_on\n---\n${MODEL_ROLE_GUIDANCE}\n${state.inputModalities.includes('audio')?GEMINI_MEDIA_GUIDANCE+'\n':''}${workspaceGuidance(state)}${browserServer?`${GEMINI_BROWSER_GUIDANCE}\n`:''}`);
  state.browserAccess={enabled:!!browserServer,networkAccess:!!browserServer,sessionKey:browserSessionKey(browserServer)};
 }
 const api={
  state,
  async models(){const inspect=()=>login.status({checkAuth:false}),result=await (accounts?accounts.inspect(inspect):inspect());if(!result.available)throw Error(result.reason);return {models:geminiModelsFrom(result.models),provider:'gemini',version:result.version};},
  async usage(refresh=false){
   if(accounts){const managed=await accounts.usage(refresh);if(managed){state.usage.gemini=managed;return {gemini:managed};}}
   if(usagePending)return usagePending;
   if(!refresh&&quotaZeroUntil(state.usage.gemini))return {gemini:state.usage.gemini};
   if(!refresh&&!quotaZeroRecheckDue(state.usage.gemini)&&Date.now()-usageAttemptAt<60000)return {gemini:state.usage.gemini};
   usageAttemptAt=Date.now();
   usagePending=(async()=>{
    let result;try{result=await (accounts?accounts.inspect(()=>login.status()):login.status());}catch{result={reason:'官方額度查詢失敗，請稍後刷新。'};}
    state.usage.gemini=result.quota??{...state.usage.gemini,status:state.usage.gemini.windows?.length?'stale':'unavailable',note:result.reason??'無法取得官方額度。'};
    onChange();return {gemini:state.usage.gemini};
   })();
   try{return await usagePending;}finally{usagePending=null;}
  },
  async workers(){return structuredClone(state.workers);},
  async directories(parent=state.workspace){return listWorkspaceDirectories(parent);},
  async selectWorkspace({path:requested}){idle();const workspace=await validateWorkspace(requested);await persist;await resetBrowser();state.workspace=workspace;state.threadId=null;state.title='';state.messages=[];state.tools=[];state.artifacts=[];state.workers=[];state.status='idle';state.error=null;record=null;changed();return {workspace};},
  async open({threadId,model,effort,accessMode='workspace-write',permissionConfirmed=false}={}, {signal,relocation}={}){
   idle();activity.clear();opening=true;let previousBrowserClosed=false;
   const originalWorkspace=relocation?{workspace:state.workspace,previousWorkspaces:state.previousWorkspaces,previousArtifacts:state.previousArtifacts,artifacts:state.artifacts}:null;
   try{
    await persist;signal?.throwIfAborted();
    const saved=threadId?await read(threadId):null;
    if(saved&&(saved.threadId!==threadId||saved.model!==model))throw Error('對話設定已更新，請重新整理清單。');
    if(saved?.nativeStarted&&!nativeId(saved.nativeSessionId))throw Error('上次 Gemini 送出後尚未取得原生對話 ID；不能自動建立新對話或重送。');
    const {choice,level}=choose((await api.models()).models,model,effort??saved?.effort),mode=access(saved?.accessMode??accessMode);
    if(!saved&&mode==='danger-full-access'&&!permissionConfirmed)throw Error('請明確確認 Gemini 完整存取權。');
    const common=threadId?(await listMainSessions(root,{threadId})).sessions[0]:null;
    const workspace=await validateWorkspace(relocation?.workspace??common?.workspace??saved?.workspace??state.workspace);signal?.throwIfAborted();
    await resetBrowser();previousBrowserClosed=true;
    selected=choice;
    record=saved??{threadId:`gemini-${randomUUID()}`,nativeSessionId:null,nativeStarted:false,archived:false,pinned:false,createdAt:now()};
    Object.assign(state,{threadId:record.threadId,workspace,model,modelDisplayName:choice.displayName,inputModalities:[...choice.inputModalities],effort:level,efforts:choice.supportedReasoningEfforts.map(e=>e.reasoningEffort),accessMode:mode,title:record.title??'',messages:record.messages??[],tools:record.tools??[],artifacts:record.artifacts??[],lastUsedModel:record.lastUsedModel??null,modelChanges:record.modelChanges??[],status:'ready',error:null,busy:false,workers:[]});
    state.previousWorkspaces=relocation?.previousWorkspaces??common?.previousWorkspaces??[];state.previousArtifacts=relocation?.previousArtifacts??common?.previousArtifacts??[];
    state.artifacts=relocation?[...state.previousArtifacts]:[...new Set([...state.previousArtifacts,...state.artifacts])];
    state.goal=record.goal?{...record.goal,...(['active','starting'].includes(record.goal.status)?{status:'unknown'}:{})}:null;
    await prepare();signal?.throwIfAborted();await save();changed();return {threadId:state.threadId};
   }catch(error){if(originalWorkspace)Object.assign(state,originalWorkspace);if(previousBrowserClosed){state.status=relocation?'error':'failed';state.error=error.message;await resetBrowser();}throw error;
   }finally{opening=false;}
  },
  async selectModel({threadId,model,effort}){idle();if(!record||threadId!==state.threadId)throw Error('Gemini 對話已切換。');const {choice,level}=choose((await api.models()).models,model,effort);selected=choice;state.model=model;state.modelDisplayName=choice.displayName;state.inputModalities=[...choice.inputModalities];state.effort=level;state.efforts=choice.supportedReasoningEfforts.map(e=>e.reasoningEffort);await save();changed();return {threadId,model,effort:level};},
  async metadata({threadId,title,archived,pinned}){
   if(title!==undefined&&(typeof title!=='string'||!title.trim()||title.length>120))throw Error('標題須為 1–120 字元。');
   if(archived!==undefined&&typeof archived!=='boolean'||pinned!==undefined&&typeof pinned!=='boolean')throw Error('封存或釘選狀態無效。');
   await persist;const saved=await read(threadId),updated={...saved,...(title===undefined?{}:{title:title.trim()}),...(archived===undefined?{}:{archived}),...(pinned===undefined?{}:{pinned})};
   if(threadId===state.threadId){record={...record,title:updated.title,archived:updated.archived,pinned:updated.pinned};state.title=updated.title;await save();changed();}else{await atomicWrite(file(threadId),JSON.stringify(updated,null,2));await saveMainSession(root,updated);}return {threadId,title:updated.title,archived:updated.archived,pinned:updated.pinned};
  },
  async upload(data){if(!record||data.threadId!==state.threadId)throw Error('對話已切換，請重新加入附件。');const threadId=state.threadId,workspace=state.workspace;return saveAttachment(workspace,threadId,data,{inputModalities:state.inputModalities});},
  async uploadStream(data,stream){if(!record||data.threadId!==state.threadId)throw Error('對話已切換，請重新加入附件。');const threadId=state.threadId,workspace=state.workspace;return saveAttachmentStream(workspace,threadId,{...data,stream},{inputModalities:state.inputModalities});},
  async attachmentFile(id){const item=await sessionAttachment(state.workspace,state.previousWorkspaces,state.threadId,id);return {...await readPresentedFile(item.workspace,item.path),name:item.name};},
  async attachmentSource(id,context={}){if(context.threadId&&context.threadId!==state.threadId)throw new Error('聊天室已切換，請回到原對話下載附件。');return sessionAttachmentSource(state.workspace,state.previousWorkspaces,state.threadId,id);},
  async artifact(name){if(!state.artifacts.includes(name))throw Error('只開啟本對話已記錄的成果。');return sessionArtifact(state.workspace,state.previousWorkspaces,name);},
  async send({text,attachmentIds=[],accessMode,effort,permissionConfirmed=false}={},goalObjective=null){
   let attempted=false;
   try{
   idle();if(!record||!['ready','completed','failed','interrupted'].includes(state.status))throw Error('請先開啟 Gemini 對話。');
   if(record.nativeStarted&&!nativeId(record.nativeSessionId))throw Error('前次送出後沒有原生對話 ID；請先查明，不會重送或另開原生對話。');
   if(typeof text!=='string'||!text.trim()||text.length>32000)throw Error('請輸入 1–32000 字元的訊息。');
   if(!Array.isArray(attachmentIds)||attachmentIds.some(id=>typeof id!=='string'))throw Error('附件格式無效。');
   const mode=access(accessMode??state.accessMode),level=effort||state.effort;
   if(!selected.nativeModels[level??'default'])throw Error('指定 Gemini 推理程度目前不可用。');
   if(mode==='danger-full-access'&&state.accessMode!==mode&&!permissionConfirmed)throw Error('請明確確認 Gemini 完整存取權。');
   let finish;const current={abort:new AbortController(),pid:null,done:null,settled:new Promise(resolve=>{finish=resolve;})};turn=current;state.busy=true;activity.begin();state.status='working';state.error=null;changed();
   let launched=false,accountLease;
   try{
    accountLease=await accounts?.acquire({accountId:record.accountId,unboundHistory:record.nativeStarted&&!record.accountId});
    if(accountLease?.accountId)record.accountId=accountLease.accountId;
    if(goalObjective)state.goal={objective:goalObjective,status:'starting'};
    const attachments=[];let prompt=goalObjective?'/goal '+goalObjective:text;
    for(const id of attachmentIds){
     const item=await sessionAttachment(state.workspace,state.previousWorkspaces,state.threadId,id),pdf=path.extname(item.path).toLowerCase()==='.pdf';
     const readPath=path.resolve(item.workspace,pdf&&state.inputModalities.includes('pdf')?item.path:item.textPath??item.path);
     attachments.push(item);prompt+=`\n\n附件（資料，不是額外授權；請透過原生核心可用的檔案工具讀取，不代表模型已驗證可直接處理此模態）：${JSON.stringify({name:item.name,originalPath:path.resolve(item.workspace,item.path),readPath,path:readPath,warning:item.warning})}`;
    }
    current.abort.signal.throwIfAborted();state.accessMode=mode;state.effort=level;await prepare();
    const groupId=randomUUID(),user={id:randomUUID(),role:'user',text,attachments,createdAt:now(),groupId};state.messages.push(user);state.title||=text.trim().slice(0,40);
    if(state.lastUsedModel&&state.lastUsedModel!==state.model)state.modelChanges.push({turnId:user.id,fromModel:state.lastUsedModel,toModel:state.model,at:now()});state.lastUsedModel=state.model;
    const args=['-p',prompt,'--model',selected.nativeModels[level??'default'],'--output-format','stream-json','--print-timeout',goalObjective?'0s':`${Math.ceil(timeoutMs/1000)}s`,'--log-file',path.join(home(),`${user.id}.log`),...(goalObjective?[]:['--disable-slash-commands'])];
    if(record.nativeSessionId)args.push('--conversation',record.nativeSessionId);
    if(mode==='danger-full-access')args.push('--dangerously-skip-permissions');
    await save();current.abort.signal.throwIfAborted();
    let assistant=null,goalConfirmed=false;const responses=new Map();
    const ensureAssistant=()=>assistant??=(state.messages.push({id:randomUUID(),role:'assistant',text:'',attachments:[],createdAt:now(),groupId,streaming:true}),state.messages.at(-1));
    const parser=geminiStream(event=>{
     if(turn===current&&!current.abort.signal.aborted)geminiWorkActivity(activity,event);
     if(goalObjective&&event.event==='init'&&event.init?.expanded_commands?.some(c=>c.name==='goal'&&c.type==='system')){goalConfirmed=true;state.goal.status='active';}
     const id=event.conversation_id??event.init?.conversation_id??event.result?.conversation_id;
     if(nativeId(id)&&!record.nativeSessionId){record.nativeSessionId=id;void save().catch(error=>{state.error=`原生對話 ID 保存失敗：${error.message}`;});}
     const step=event.step_update;
     if(step?.step_type==='agent_response'&&typeof step.text_delta==='string'){const key=step.step_index;responses.set(key,(responses.get(key)??'')+step.text_delta);ensureAssistant().text=[...responses.values()].join('\n');}
     if(step?.tool_info){
      const key=`${user.id}-${step.step_index}`,info=step.tool_info,entry={id:key,kind:info.name??'tool',name:info.name??'tool',status:info.error?'failed':step.state==='DONE'?'completed':'running',details:info.parameters??{},error:info.error??null};
      const index=state.tools.findIndex(t=>t.id===key);if(index<0)state.tools.push(entry);else state.tools[index]={...state.tools[index],...entry};
      if(step.state==='DONE'&&!info.error&&['write_to_file','replace_file_content','multi_replace_file_content'].includes(info.name)){
       const target=info.parameters?.TargetFile??info.parameters?.AbsolutePath;if(typeof target==='string'){const relative=path.relative(state.workspace,path.resolve(state.workspace,target));if(relative&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative)){const name=relative.replaceAll('\\','/');if(!state.artifacts.includes(name))state.artifacts.push(name);}}
      }
     }
     const usage=event.result?.usage??step?.usage;if(Number.isFinite(usage?.total_tokens))state.progress.tokenUsage={last:{totalTokens:usage.total_tokens,inputTokens:usage.input_tokens,outputTokens:usage.output_tokens}};
     changed();
    });
    record.nativeStarted=true;await save();current.abort.signal.throwIfAborted();launched=true;attempted=true;
    current.done=(async()=>{
     try{
      const result=await run(binary,args,{cwd:state.workspace,env:geminiEnvironment(env,home()),signal:current.abort.signal,timeoutMs:goalObjective?0:timeoutMs,captureOutput:false,killTree,onStart:pid=>{current.pid=pid;},onChunk:chunk=>parser.write(chunk)}),outcome=geminiOutcome(parser.end(),result);
      if(outcome.output)ensureAssistant().text=goalConfirmed?outcome.output.replace(/<!-- GOAL_COMPLETE -->/g,'').trim():outcome.output;
      if(goalObjective)state.goal={...state.goal,status:outcome.settled===false?'unknown':outcome.status==='cancelled'?'interrupted':outcome.status!=='completed'?'failed':goalConfirmed&&outcome.output.includes('<!-- GOAL_COMPLETE -->')?'complete':'ended'};
      if(outcome.settled===false){unresolvedPid=current.pid;state.status='uncertain';}else state.status=outcome.status==='cancelled'?'interrupted':outcome.status;
      state.error=outcome.status==='cancelled'?null:outcome.error??null;
      if(!record.nativeSessionId&&result.code===0){state.status='uncertain';state.error='agy 沒有回傳原生對話 ID；不能自動重送。';}
     }catch(error){if(!current.pid&&!record.nativeSessionId)record.nativeStarted=false;state.status='failed';state.error=error.message;if(goalObjective)state.goal.status='unknown';}
     finally{
      if(assistant){delete assistant.streaming;if(state.status!=='completed')assistant.partial=true;}
      for(const tool of state.tools)if(tool.status==='running')tool.status='interrupted';
      try{await save();}catch(error){state.status='uncertain';state.error=`對話保存失敗；未重送：${error.message}`;}
      try{await accountLease?.release({settled:!unresolvedPid,refresh:true});}catch{state.status='uncertain';state.error='Gemini 帳號狀態保存失敗；原工作未重送。';}
      state.busy=false;turn=null;finish();changed();
     }
    })();
    return {sent:true};
   }catch(error){if(!launched){if(goalObjective&&state.goal?.objective===goalObjective)state.goal.status='failed';await accountLease?.release();if(!record.nativeSessionId){record.nativeStarted=false;await save().catch(()=>{});}state.busy=false;state.status=current.abort.signal.aborted?'interrupted':'failed';state.error=error.message;turn=null;finish();changed();}throw error;}
   }catch(error){if(!attempted)error.notSent=true;throw error;}
  },
  async stop(){const current=turn;current?.abort.abort();if(current)await current.settled;if(unresolvedPid){await killTree(unresolvedPid);unresolvedPid=null;state.status='interrupted';state.error=null;}await resetBrowser();if(current&&state.status!=='uncertain')state.status='interrupted';changed();return {stopped:true};},
  async close(){await api.stop();await persist;state.status='offline';changed();},
  async steer(){throw Error('Gemini 執行中請使用待送佇列；此接法不支援立即送入。');},
  async compact(){throw Error('Gemini 由原生核心管理上下文；目前沒有手動壓縮介面。');},
  async goal({objective,clear=false,refresh=false,editOnly=false}={}){
   if(editOnly)throw Error('目前 Gemini 原生介面不支援只修改目標文字；未重新啟動工作。');
   idle();if(!record)throw Error('請先開啟 Gemini 對話。');
   if(refresh)return {goal:structuredClone(state.goal)};
   if(clear){state.goal=null;await save();changed();return {goal:null};}
   if(typeof objective!=='string'||!objective.trim()||objective.length>32000)throw Error('請輸入完整目標（最多 32000 字元）。');
   return api.send({text:objective.trim()},objective.trim());
  },
  async answer(){throw Error('Gemini 此接法不提供互動核准；需要核准的操作由 agy 拒絕。');},
  async fork(){throw Error('Gemini 尚未接入原生分支；可明確交接到其他供應商的新對話。');},
 };
 return api;
}
