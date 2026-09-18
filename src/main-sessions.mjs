import {mkdir,open,readdir,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeWorkspacePath} from './workspaces.mjs';
import {validMainModel} from './main-models.mjs';
import {normalizeWorkerPolicy} from './worker-policy.mjs';
import {permissionMode} from './desktop-permissions.mjs';
let lastSaveOrder=0;
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/u.test(id);
const normalizeModelChanges=changes=>Array.isArray(changes)?changes.filter(change=>change&&typeof change.turnId==='string'&&change.turnId.length>0&&validMainModel(change.fromModel)&&validMainModel(change.toModel)&&typeof change.at==='string').map(({turnId,fromModel,toModel,at})=>({turnId,fromModel,toModel,at})):[];
export async function saveMainSession(root,{threadId,model,title='',archived=false,pinned=false,workspace=root,workerPolicy,effort=null,accessMode='read-only',lastUsedModel=null,modelChanges=[]}) {
  if(!validId(threadId)||!validMainModel(model))throw new Error('Invalid K session.');
  const selectedWorkspace=normalizeWorkspacePath(workspace);
  const directory=path.join(root,'.runtime/main-sessions');await mkdir(directory,{recursive:true});
  const saveOrder=Math.max(Date.now()*1000,lastSaveOrder+1);lastSaveOrder=saveOrder;
  const target=path.join(directory,`${threadId}-${saveOrder}-${randomUUID()}.json`);
  const file=await open(target,'wx');
  try {await file.writeFile(JSON.stringify({threadId,model,title,archived,pinned,saveOrder,accountType:'chatgpt',workspace:selectedWorkspace,workerPolicy:normalizeWorkerPolicy(workerPolicy),effort:typeof effort==='string'?effort:null,accessMode:permissionMode(accessMode),lastUsedModel:validMainModel(lastUsedModel)?lastUsedModel:null,modelChanges:normalizeModelChanges(modelChanges),savedAt:new Date().toISOString()},null,2));await file.sync();}finally{await file.close();}
  return target;
}
export async function listMainSessions(root) {
  const directory=path.join(root,'.runtime/main-sessions');
  let names;try{names=await readdir(directory);}catch(error){if(error.code==='ENOENT')return {sessions:[],unreadable:0};throw error;}
  const sessions=new Map();let unreadable=0;
  for(const name of names.filter(n=>n.endsWith('.json'))){
    try{
      const target=path.join(directory,name);const info=await lstat(target);
      if(!info.isFile()||info.isSymbolicLink()||info.size>1048576)throw new Error('Unsupported record.');
      const record=JSON.parse(await readFile(target,'utf8'));
      if(!validId(record.threadId)||!validMainModel(record.model))throw new Error('Invalid record.');
      // Records written before workspace selection have no field; they remain
      // attached to K's root. A stored external workspace is intentionally
      // allowed, but still must be absolute and not a drive root/HOME.
      const workspace=normalizeWorkspacePath(record.workspace===undefined?root:record.workspace);
      const item={threadId:record.threadId,model:record.model,workerPolicy:normalizeWorkerPolicy(record.workerPolicy),effort:typeof record.effort==='string'?record.effort:null,accessMode:permissionMode(record.accessMode??'read-only'),lastUsedModel:validMainModel(record.lastUsedModel)?record.lastUsedModel:null,modelChanges:normalizeModelChanges(record.modelChanges),title:typeof record.title==='string'?record.title:'',archived:record.archived===true,pinned:record.pinned===true,workspace,lastOpenedAt:info.mtime.toISOString(),mtime:Math.max(info.mtimeMs*1000,record.saveOrder??0)};
      if(!sessions.has(item.threadId)||sessions.get(item.threadId).mtime<item.mtime)sessions.set(item.threadId,item);
    }catch{unreadable++;}
  }
  return {sessions:[...sessions.values()].sort((a,b)=>b.mtime-a.mtime).map(({mtime,...item})=>item),unreadable};
}
