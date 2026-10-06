import {readdir,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {atomicWrite} from './atomic-write.mjs';
import {normalizeWorkspacePath} from './workspaces.mjs';
import {validMainModel} from './main-models.mjs';
import {normalizeWorkerPolicy} from './worker-policy.mjs';
import {permissionMode} from './desktop-permissions.mjs';
import {normalizeClaudeAccessMode} from './claude-host.mjs';
import {modelProvider} from '../shared/model-provider.mjs';
const sessionAccessMode=(model,value)=>model.startsWith('claude-')?normalizeClaudeAccessMode(value):permissionMode(value);
let lastSaveOrder=0;
const saves=new Map();
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/u.test(id);
const normalizeCodexSession=value=>value&&validId(value.nativeThreadId)&&typeof value.hasSubmitted==='boolean'?{nativeThreadId:value.nativeThreadId,hasSubmitted:value.hasSubmitted}:null;
const normalizeModelChanges=changes=>Array.isArray(changes)?changes.filter(change=>change&&typeof change.turnId==='string'&&change.turnId.length>0&&validMainModel(change.fromModel)&&validMainModel(change.toModel)&&typeof change.at==='string').map(({turnId,fromModel,toModel,at,reason,fromEffort,toEffort,sourceTurnId})=>({turnId,fromModel,toModel,at,...(reason==='capacity'?{reason,fromEffort:typeof fromEffort==='string'?fromEffort:null,toEffort:'medium',sourceTurnId:typeof sourceTurnId==='string'?sourceTurnId:null}:{})})):[];
const validWorkerRequestId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id)&&id!=='.'&&id!=='..';
const normalizeWorkerNotifications=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter(([id,status])=>validWorkerRequestId(id)&&status==='delivery-attempted')):{};
export function saveMainSession(root,record,{rejectedCodexSubmission=false}={}){
  const key=path.join(path.resolve(root),String(record.threadId));
  const next=(saves.get(key)??Promise.resolve()).catch(()=>{}).then(()=>writeMainSession(root,record,rejectedCodexSubmission));
  saves.set(key,next);
  return next.finally(()=>{if(saves.get(key)===next)saves.delete(key);});
}
async function writeMainSession(root,{threadId,model,title='',archived=false,pinned=false,workspace=root,workerPolicy,effort=null,accessMode='read-only',lastUsedModel=null,modelChanges=[],parentThreadId,parentTitle,branchType,browserSessionKey,workerNotifications,previousWorkspaces,previousArtifacts,codexSession},rejectedCodexSubmission) {
  if(!validId(threadId)||!validMainModel(model))throw new Error('Invalid K session.');
  const prior=(await listMainSessions(root,{threadId})).sessions[0];
  if(parentThreadId===undefined){parentThreadId=prior?.parentThreadId??null;parentTitle=prior?.parentTitle??null;branchType??=prior?.branchType??null;}
  browserSessionKey??=prior?.browserSessionKey??null;workerNotifications??=prior?.workerNotifications??{};previousWorkspaces??=prior?.previousWorkspaces??[];previousArtifacts??=prior?.previousArtifacts??[];
  // Only a confirmed rejection of the first request can clear this marker;
  // ordinary metadata writes (including stale renames) remain monotonic.
  const rejected=rejectedCodexSubmission&&codexSession?.hasSubmitted===false&&codexSession.nativeThreadId===prior?.codexSession?.nativeThreadId;
  codexSession=prior?.codexSession?.hasSubmitted&&!rejected?prior.codexSession:codexSession??prior?.codexSession??null;
  const selectedWorkspace=normalizeWorkspacePath(workspace);
  const moved={previousWorkspaces:previousWorkspaces.map(normalizeWorkspacePath),previousArtifacts};
  const directory=path.join(root,'.runtime/main-sessions');
  const saveOrder=Math.max(Date.now()*1000,lastSaveOrder+1);lastSaveOrder=saveOrder;
  const target=path.join(directory,`${threadId}-current.json`);
  await atomicWrite(target,JSON.stringify({threadId,model,codexSession:normalizeCodexSession(codexSession),title,archived,pinned,saveOrder,browserSessionKey:typeof browserSessionKey==='string'&&/^[A-Za-z0-9-]{1,100}$/.test(browserSessionKey)?browserSessionKey:null,branchType:branchType==='user'?'user':null,parentThreadId:validId(parentThreadId)?parentThreadId:null,parentTitle:typeof parentTitle==='string'?parentTitle:null,provider:modelProvider(model),accountType:model.startsWith('claude-')?'claude.ai':model.startsWith('gemini-')?'antigravity':'chatgpt',workspace:selectedWorkspace,...moved,workerPolicy:normalizeWorkerPolicy(workerPolicy),effort:typeof effort==='string'?effort:null,accessMode:sessionAccessMode(model,accessMode),lastUsedModel:validMainModel(lastUsedModel)?lastUsedModel:null,modelChanges:normalizeModelChanges(modelChanges),workerNotifications:normalizeWorkerNotifications(workerNotifications),savedAt:new Date().toISOString()},null,2));
  return target;
}
export async function listMainSessions(root,{threadId}={}) {
  const directory=path.join(root,'.runtime/main-sessions');
  let names;try{names=await readdir(directory);}catch(error){if(error.code==='ENOENT')return {sessions:[],unreadable:0};throw error;}
  const sessions=new Map();let unreadable=0;
  for(const name of names.filter(n=>n.endsWith('.json')&&(threadId===undefined||n===`${threadId}.json`||n.startsWith(`${threadId}-`)))){
    try{
      const target=path.join(directory,name);const info=await lstat(target);
      if(!info.isFile()||info.isSymbolicLink()||info.size>1048576)throw new Error('Unsupported record.');
      const record=JSON.parse(await readFile(target,'utf8'));
      if(!validId(record.threadId)||!validMainModel(record.model))throw new Error('Invalid record.');
      if(threadId!==undefined&&record.threadId!==threadId)continue;
      // Records written before workspace selection have no field; they remain
      // attached to K's root. A stored external workspace is intentionally
      // allowed, but still must be absolute and not a drive root/HOME.
      const workspace=normalizeWorkspacePath(record.workspace===undefined?root:record.workspace);
      const moved={previousWorkspaces:(record.previousWorkspaces??[]).map(normalizeWorkspacePath),previousArtifacts:(record.previousArtifacts??[]).filter(name=>typeof name==='string'&&path.isAbsolute(name))};
      const item={codexSession:normalizeCodexSession(record.codexSession),browserSessionKey:typeof record.browserSessionKey==='string'&&/^[A-Za-z0-9-]{1,100}$/.test(record.browserSessionKey)?record.browserSessionKey:null,branchType:record.branchType==='user'?'user':null,parentThreadId:validId(record.parentThreadId)?record.parentThreadId:null,parentTitle:typeof record.parentTitle==='string'?record.parentTitle:null,provider:modelProvider(record.model),threadId:record.threadId,model:record.model,workerPolicy:normalizeWorkerPolicy(record.workerPolicy),effort:typeof record.effort==='string'?record.effort:null,accessMode:sessionAccessMode(record.model,record.accessMode??'read-only'),lastUsedModel:validMainModel(record.lastUsedModel)?record.lastUsedModel:null,modelChanges:normalizeModelChanges(record.modelChanges),workerNotifications:normalizeWorkerNotifications(record.workerNotifications),title:typeof record.title==='string'?record.title:'',archived:record.archived===true,pinned:record.pinned===true,workspace,lastOpenedAt:info.mtime.toISOString(),mtime:Math.max(info.mtimeMs*1000,record.saveOrder??0)};
      Object.assign(item,moved);
      if(!sessions.has(item.threadId)||sessions.get(item.threadId).mtime<item.mtime)sessions.set(item.threadId,item);
    }catch{unreadable++;}
  }
  return {sessions:[...sessions.values()].sort((a,b)=>b.mtime-a.mtime).map(({mtime,...item})=>item),unreadable};
}
