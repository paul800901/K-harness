import path from 'node:path';
import {access} from 'node:fs/promises';
import {loadAttachment,readPresentedFile} from './desktop-files.mjs';

const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);};

// Retain references, not copies of project files or native conversation history.
export function movedWorkspace(record,artifacts,workspace){
 return {
  workspace,
  previousWorkspaces:[...new Set([...(record.previousWorkspaces??[]),record.workspace])],
  previousArtifacts:[...new Set([...(record.previousArtifacts??[]),...artifacts.map(name=>path.resolve(record.workspace,name))])],
 };
}

export async function sessionAttachment(workspace,previousWorkspaces,threadId,id){
 // Unsent attachments belong to the same conversation too. Their UUID and
 // thread ownership are still checked by loadAttachment; never search other chats.
 if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/u.test(id))throw Error('附件 ID 無效。');
 for(const root of [workspace,...(previousWorkspaces??[])]){
  try{await access(path.join(root,'.runtime/uploads',id,'attachment.json'));}
  catch(error){if(error.code==='ENOENT')continue;throw error;}
  return {...await loadAttachment(root,threadId,id),workspace:root};
 }
 throw Error('找不到這個對話的附件；原檔案未搬移或刪除。');
}

export async function sessionArtifact(workspace,previousWorkspaces,name){
 if(!path.isAbsolute(name))return readPresentedFile(workspace,name);
 const root=[workspace,...(previousWorkspaces??[])].find(root=>inside(root,name));
 if(!root)throw Error('成果不在這個對話使用過的工作區內。');
 return readPresentedFile(root,path.relative(root,name));
}

export function workspaceGuidance(state){
 return state.previousWorkspaces?.length?`\n目前工作區已由使用者移至 ${JSON.stringify(state.workspace)}。延續同一段對話；舊工作區路徑只屬歷史，後續相對路徑、規則與工具以目前工作區為準。不要自行搬移專案檔案、重做已完成工作或擴張權限。\n`:'';
}
