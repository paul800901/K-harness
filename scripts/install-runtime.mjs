import path from 'node:path';
import net from 'node:net';
import {mkdir,readFile,writeFile,rename,copyFile,stat} from 'node:fs/promises';
import {atomicWrite} from '../src/atomic-write.mjs';

export const candidateRelative='.runtime/isolation-pilot/sandboxie-candidate-3b6c43ee';
export function installationPaths(root){
 root=path.resolve(root);
 return {root,candidate:path.join(root,candidateRelative),runtime:path.join(root,candidateRelative,'trusted-runtime'),
  launcher:path.join(root,'local-launcher/dist/K桌面啟動器.exe'),entry:path.join(root,'Start-K-Desktop.ps1'),settings:path.join(root,'.local/runtime.json')};
}
export async function readSettings(root){
 try{return JSON.parse(await readFile(installationPaths(root).settings,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}
}
export async function assertStopped(){
 await new Promise((resolve,reject)=>{
  const socket=net.connect({host:'127.0.0.1',port:47831});
  socket.once('connect',()=>{socket.destroy();reject(Error('請先「離開並停止 K」，更新不會強制結束工作。'));});
  socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));
  socket.setTimeout(2000,()=>{socket.destroy();reject(Error('無法確認 K 已停止。'));});
 });
}
async function exists(file){try{await stat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function under(root,file){
 const relative=path.relative(path.resolve(root),path.resolve(file));
 if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw Error('版本路徑必須在本次 K 目錄內。');
}

// Only program files are exchanged. Provider homes, conversations and browser profiles stay in place.
export async function activateRuntime({root,prepared,version,settings={},checkStopped=assertStopped,
 launcherSource=path.join(prepared,'local-launcher/dist/K桌面啟動器.exe'),entrySource=path.join(prepared,'Start-K-Desktop.ps1')}){
 const p=installationPaths(root);under(p.candidate,prepared);
 for(const file of ['src/electron-isolated-launcher.mjs','dist-ui/index.html'])
  if(!(await stat(path.join(prepared,file))).isFile())throw Error(`候選缺少 ${file}`);
 for(const file of [launcherSource,entrySource])if(!(await stat(file)).isFile())throw Error(`候選缺少 ${file}`);
 await checkStopped();
 const before=await readSettings(root),hadRuntime=await exists(p.runtime);
 const backup=path.join(p.candidate,'releases',`before-${Date.now()}`);await mkdir(backup,{recursive:true});
 for(const [name,file] of [['launcher.exe',p.launcher],['Start-K-Desktop.ps1',p.entry]])
  if(await exists(file))await copyFile(file,path.join(backup,name));
 await writeFile(path.join(backup,'settings.json'),JSON.stringify(before,null,2));
 // Save these before moving the prepared directory (legacy runtime had no launcher sources).
 await copyFile(launcherSource,path.join(backup,'incoming-launcher.exe'));
 await copyFile(entrySource,path.join(backup,'incoming-entry.ps1'));
 let movedOld=false,movedNew=false;
 try{
  if(hadRuntime){await rename(p.runtime,path.join(backup,'runtime'));movedOld=true;}
  await rename(prepared,p.runtime);movedNew=true;
  await mkdir(path.dirname(p.launcher),{recursive:true});
  await copyFile(path.join(backup,'incoming-launcher.exe'),p.launcher);
  await copyFile(path.join(backup,'incoming-entry.ps1'),p.entry);
  await atomicWrite(p.settings,JSON.stringify({...before,...settings,version,previous:hadRuntime?backup:null},null,2));
 }catch(error){
  if(movedNew)await rename(p.runtime,prepared);
  if(movedOld)await rename(path.join(backup,'runtime'),p.runtime);
  for(const [name,file] of [['launcher.exe',p.launcher],['Start-K-Desktop.ps1',p.entry]])
   if(await exists(path.join(backup,name)))await copyFile(path.join(backup,name),file);
   else if(await exists(file))await rename(file,path.join(backup,`failed-${name}`));
  throw error;
 }
 return {version,runtime:p.runtime,previous:hadRuntime?backup:null};
}

export async function rollbackRuntime(root,{checkStopped=assertStopped}={}){
 const p=installationPaths(root),current=await readSettings(root),backup=current.previous;
 if(!backup)throw Error('尚無可退回的上一版。');under(p.candidate,backup);
 const oldRuntime=path.join(backup,'runtime');await stat(oldRuntime);await checkStopped();
 const oldSettings=JSON.parse(await readFile(path.join(backup,'settings.json'),'utf8'));
 // Reuse the same activation transaction; the outgoing version remains recoverable too.
 return activateRuntime({root,prepared:oldRuntime,version:oldSettings.version??'pre-git-install',
  settings:{...oldSettings,nodeExecutable:oldSettings.nodeExecutable??current.nodeExecutable},checkStopped,
  launcherSource:path.join(backup,'launcher.exe'),entrySource:path.join(backup,'Start-K-Desktop.ps1')});
}
