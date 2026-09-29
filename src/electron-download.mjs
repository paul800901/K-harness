import {randomUUID} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {copyFile,lstat,mkdir,realpath,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const isInside=(root,target)=>{
 const relative=path.relative(root,target);
 return !!relative&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);
};

async function ensureOwnedDirectory(root,target){
 const relative=path.relative(root,target);
 if(!relative||!isInside(root,target))throw new Error('Native download staging must be inside the browser profile.');
 let cursor=root;
 for(const part of relative.split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);
  try{
   const info=await lstat(cursor);
   if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Native download staging contains a link or non-directory component.');
  }catch(error){
   if(error.code!=='ENOENT')throw error;
   try{await mkdir(cursor);}catch(createError){if(createError.code!=='EEXIST')throw createError;}
   const info=await lstat(cursor);
   if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Native download staging contains a link or non-directory component.');
  }
 }
 const actual=await realpath(target);
 const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
 if(normalize(actual)!==normalize(target)||!isInside(root,actual))throw new Error('Native download staging escaped the browser profile.');
 return actual;
}

async function markZone(target){
 if(process.platform!=='win32')return;
 const marker='[ZoneTransfer]\r\nZoneId=3\r\n';
 await writeFile(`${target}:Zone.Identifier`,marker,{encoding:'utf8',flag:'w'});
 if(await readFile(`${target}:Zone.Identifier`,'utf8')!==marker)throw new Error('Native download security marker could not be verified.');
}

/**
 * Prepare the owner-only Electron Session will-download hook. Native files are
 * staged under an opaque .download name; the compatible saveAs adapter copies
 * only through the existing live-session safeSaveAs policy.
 */
export async function prepareNativeDownloads({profileRoot,stagingRoot,onDownload}={}){
 if(typeof profileRoot!=='string'||!path.isAbsolute(profileRoot)||typeof stagingRoot!=='string'||!path.isAbsolute(stagingRoot))throw new Error('Absolute browser profile and staging directories are required.');
 if(typeof onDownload!=='function')throw new TypeError('An owner native-download callback is required.');
 const profile=await realpath(profileRoot),staging=path.resolve(stagingRoot);
 if(!isInside(profile,staging))throw new Error('Native download staging must be inside the browser profile.');
 const ownedStaging=await ensureOwnedDirectory(profile,staging);

 return function willDownload(event,item,webContents){
  let target,settle,reject;
  const completion=new Promise((resolve,rejectPromise)=>{settle=resolve;reject=rejectPromise;});
  // The Electron event may be the only consumer; never leave a rejected promise unhandled.
  completion.catch(()=>{});
  let terminal=false;
  const cancel=()=>{try{event?.preventDefault?.();}catch{}};
  if(!event||typeof event.preventDefault!=='function'||!item||typeof item.setSavePath!=='function'||typeof item.once!=='function'||!webContents){cancel();return false;}
  item.once('done',(_doneEvent,state)=>{
   if(terminal)return;
   terminal=true;
   void (async()=>{
    if(state!=='completed')throw new Error(`Native browser download ${state??'failed'}.`);
    const info=await lstat(target);
    if(info.isSymbolicLink()||!info.isFile()||!isInside(ownedStaging,target))throw new Error('Native browser download staging file is unsafe.');
    await markZone(target);
    settle();
   })().catch(reject);
  });
  const id=randomUUID();target=path.join(ownedStaging,`${id}.download`);
  try{
   item.setSavePath(target);
   const compatibleDownload={
    suggestedFilename:()=>item.getFilename?.()??'download',
    url:()=>item.getURL?.()??'',
    saveAs:async destination=>{
     await completion;
     await copyFile(target,destination,fsConstants.COPYFILE_EXCL);
    },
   };
   const handled=onDownload(compatibleDownload,{webContents,id});
   if(handled&&typeof handled.then==='function'){
    void Promise.resolve(handled).catch(()=>{});
    throw new Error('Native browser download callback must be synchronous.');
   }
   return true;
  }catch{
   cancel();
   if(!terminal){terminal=true;reject(new Error('Native browser download could not be accepted safely.'));}
   return false;
  }
 }
}
