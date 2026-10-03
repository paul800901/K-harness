import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readdir,lstat,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const execFile=promisify(execFileCallback);
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/u.test(id);

async function sendDirectoryToRecycleBin(directory){
 if(process.platform!=='win32')throw new Error('此平台無法安全移至 Windows 資源回收筒。');
 const script="$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; $target = $env:K_ARCHIVE_DELETE_DIRECTORY; if ([string]::IsNullOrWhiteSpace($target)) { throw 'Missing recycle-bin target.' }; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($target, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin); if (Test-Path -LiteralPath $target) { throw 'Target still exists after recycle-bin operation.' }";
 await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,K_ARCHIVE_DELETE_DIRECTORY:directory}});
}

async function safeDirectory(parent,name){
 const target=path.join(parent,name);
 try{const info=await lstat(target);if(!info.isDirectory()||info.isSymbolicLink())throw new Error(`拒絕非一般目錄：${target}`);return target;}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}

/** Move only K-owned metadata/projections/queue files for explicitly selected archived ids to the recycle bin. */
export async function deleteArchived({root,threadIds,confirmed,currentThreadId=null,recycler=sendDirectoryToRecycleBin}){
 if(confirmed!==true)throw new Error('必須明確確認刪除。');
 if(!Array.isArray(threadIds)||threadIds.length<1||threadIds.length>500||threadIds.some(id=>!validId(id))||new Set(threadIds).size!==threadIds.length)throw new Error('threadIds 必須是 1–500 個互不重複的有效 K 對話 ID。');
 const absoluteRoot=path.resolve(root),runtime=path.join(absoluteRoot,'.runtime');
 let rootInfo;try{rootInfo=await lstat(absoluteRoot);}catch{throw new Error('K 專案根目錄不存在。');}
 if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw new Error('拒絕 symlink/junction 專案根目錄。');
 const runtimeInfo=await safeDirectory(absoluteRoot,'.runtime');
 if(!runtimeInfo)throw new Error('K runtime 目錄不存在。');
 const mainDir=await safeDirectory(runtime,'main-sessions');
 const claudeDir=await safeDirectory(runtime,'claude-sessions');
 const geminiDir=await safeDirectory(runtime,'gemini-sessions');
 const queueDir=await safeDirectory(runtime,'input-queues');
 const deletedIds=[],failed=[];
 for(const threadId of threadIds){
  if(threadId===currentThreadId){failed.push({threadId,error:'目前開啟的對話不能刪除。'});continue;}
  try{
   const sources=[];
   if(mainDir){
    for(const name of await readdir(mainDir)){
     if(!name.endsWith('.json')||!name.startsWith(`${threadId}-`))continue;
     const source=path.join(mainDir,name),info=await lstat(source);
     if(!info.isFile()||info.isSymbolicLink())throw new Error('K 對話紀錄含 symlink 或非一般檔案，已拒絕。');
     let record;try{record=JSON.parse(await readFile(source,'utf8'));}catch{throw new Error('K 對話紀錄無法讀取，未刪除。');}
     if(record.threadId===threadId)sources.push(source);
    }
   }
   if(!sources.length)throw new Error('K 對話紀錄不存在。');
   // Latest append-only record controls archived state; sort as listMainSessions does.
   const records=await Promise.all(sources.map(async file=>{const [record,info]=await Promise.all([readFile(file,'utf8').then(JSON.parse),lstat(file)]);return {record,mtime:Math.max(info.mtimeMs*1000,record.saveOrder??0)};}));
   records.sort((a,b)=>b.mtime-a.mtime);
   if(records[0].record.archived!==true)throw new Error('只能刪除已封存的 K 對話。');
   for(const projectionDir of [claudeDir,geminiDir].filter(Boolean)){
    const projection=path.join(projectionDir,`${threadId}.json`);
    try{const info=await lstat(projection);if(!info.isFile()||info.isSymbolicLink())throw new Error('Claude 投影含 symlink 或非一般檔案，已拒絕。');sources.push(projection);}catch(error){if(error.code!=='ENOENT')throw error;}
   }
   if(queueDir){
    const queue=path.join(queueDir,`${threadId}.json`);
    try{const info=await lstat(queue);if(!info.isFile()||info.isSymbolicLink())throw new Error('待送佇列含 symlink 或非一般檔案，已拒絕。');sources.push(queue);}catch(error){if(error.code!=='ENOENT')throw error;}
   }
   const staging=path.join(runtime,`.archive-delete-${randomUUID()}`);
   await mkdir(staging);
   const moved=[];
   try{
    for(let i=0;i<sources.length;i++){
     const source=sources[i];
     // Recheck each source immediately before moving it to avoid following a swapped link.
     const info=await lstat(source);if(!info.isFile()||info.isSymbolicLink())throw new Error('K 對話來源已變更，未刪除。');
     const target=path.join(staging,`${String(i).padStart(4,'0')}-${path.basename(source)}`);
     await rename(source,target);moved.push({source,target});
    }
    const manifest={version:1,threadId,files:moved.map(({source,target})=>({stagedName:path.basename(target),originalPath:path.relative(runtime,source)}))};
    await writeFile(path.join(staging,'K-restore-manifest.json'),JSON.stringify(manifest,null,2),'utf8');
    await recycler(staging);
    try{await lstat(staging);throw new Error('資源回收流程返回成功，但暫存仍在原位置；已復原 K 檔案。');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    deletedIds.push(threadId);
   }catch(error){
    const restoreErrors=[];
    for(const item of moved.reverse())try{await rename(item.target,item.source);}catch(restoreError){restoreErrors.push(`${path.basename(item.source)}: ${restoreError.message}`);}
    if(restoreErrors.length)throw new Error(`${error.message}；部分來源未能復原，暫存於 ${staging}（${restoreErrors.join('；')}）。`);
    throw error;
   }
  }catch(error){failed.push({threadId,error:error?.message??'刪除失敗。'});}
 }
 return {deletedIds,failed};
}
