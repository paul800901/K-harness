import {readFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';

// Only the trusted K owner reads this descriptor from its protected vault.
// No Chrome launch, foreground operation, or command retry is permitted here.
export function validateProfileId(profileId){
 if(typeof profileId!=='string'||!/^[a-f0-9]{32}$/.test(profileId))throw Error('K Chrome 設定檔識別碼無效。');
 return profileId;
}

async function readDescriptor(descriptorPath){
 const info=await lstat(descriptorPath);if(info.isSymbolicLink()||!info.isFile()||info.size>4096)throw Error('Unsafe descriptor.');
 return JSON.parse(await readFile(descriptorPath,'utf8'));
}

// On demand only; return identity/capabilities, never bearer secrets or paths.
export async function listChromeProfiles({descriptorPath,timeoutMs=500}){
 const prefix=path.basename(descriptorPath)+'.',root=path.dirname(descriptorPath);
 const files=await readdir(root),profiles=[];
 for(const file of files){
  if(!file.startsWith(prefix)||!file.endsWith('.json'))continue;
  const profileId=file.slice(prefix.length,-5);if(!/^[a-f0-9]{32}$/.test(profileId))continue;
  try{
   const descriptor=await readDescriptor(path.join(root,file));
   if(descriptor.profileId!==profileId)continue;
   const status=await nativeRequest(descriptor,{type:'status'},timeoutMs);
   if(status.profileId!==profileId||typeof status.incognitoAllowed!=='boolean')continue;
   profiles.push({profileId,connected:true,modes:status.incognitoAllowed?['regular','incognito']:['regular']});
  }catch{profiles.push({profileId,connected:false,modes:[]});}
 }
 return profiles.sort((a,b)=>a.profileId.localeCompare(b.profileId));
}

export async function readChromeProfileDescriptor({descriptorPath,profileId}){
 validateProfileId(profileId);
 const descriptor=await readDescriptor(`${descriptorPath}.${profileId}.json`);
 if(descriptor.profileId!==profileId)throw Error('K Chrome 設定檔連線不符。');
 return descriptor;
}

export async function openChromeConnectPageViaNative({descriptorPath,descriptor,timeoutMs=12000},url){
 let selected=descriptor;
 try{selected??=await readDescriptor(descriptorPath);}
 catch{throw Error('K 專用 Chrome 尚未連上瀏覽器助手。請手動開啟 K 專用 Chrome 並載入新版擴充；K 不會自動跳出瀏覽器視窗。');}
 await nativeRequest(selected,{type:'openConnectPage',url},timeoutMs);
}

async function nativeRequest(descriptor,request,timeoutMs){
 let endpoint;
 try{endpoint=new URL(descriptor.endpoint);}catch{throw Error('K 瀏覽器助手原生連線資料無效。');}
 if(descriptor.version!==2||!/^[a-f0-9]{32}$/.test(descriptor.profileId??'')||endpoint.protocol!=='ws:'||endpoint.hostname!=='127.0.0.1'||!endpoint.port||endpoint.pathname!=='/connect'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password||!/^[a-f0-9]{64}$/u.test(descriptor.token??''))throw Error('K 瀏覽器助手原生連線資料無效。');
 const id=randomUUID();
 return new Promise((resolve,reject)=>{
  const socket=new WebSocket(endpoint,{headers:{Authorization:`Bearer ${descriptor.token}`},maxPayload:1024*1024});
  let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);socket.terminate();error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(Error('K 瀏覽器助手背景連線逾時；沒有重送或切換前景視窗。')),timeoutMs);
  socket.on('open',()=>socket.send(JSON.stringify({id,...request})));
  socket.on('message',data=>{
   let message;try{message=JSON.parse(data.toString());}catch{return finish(Error('K 瀏覽器助手回覆格式無效。'));}
   if(message.id!==id)return finish(Error('K 瀏覽器助手回覆不符本次工作。'));
   finish(message.ok===true?undefined:Error('K 瀏覽器助手無法在背景建立連線頁。請確認專用 Chrome 的擴充已啟用；沒有退回前景啟動。'),message);
  });
  socket.on('error',()=>finish(Error('K 專用 Chrome 的原生連線不可用。請手動開啟專用 Chrome 或重新載入 K 瀏覽器助手；K 不會搶走前景視窗。')));
  socket.on('close',()=>finish(Error('K 瀏覽器助手背景連線已中斷；沒有自動重送。')));
 });
}
