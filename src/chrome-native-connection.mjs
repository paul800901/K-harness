import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';

// Only the trusted K owner reads this descriptor from its protected vault.
// No Chrome launch, foreground operation, or command retry is permitted here.
export async function openChromeConnectPageViaNative({descriptorPath,timeoutMs=12000},url){
 let descriptor;
 try{descriptor=JSON.parse(await readFile(descriptorPath,'utf8'));}
 catch{throw Error('K 專用 Chrome 尚未連上瀏覽器助手。請手動開啟 K 專用 Chrome 並載入新版擴充；K 不會自動跳出瀏覽器視窗。');}
 if(descriptor.connected===false)throw Error('K 專用 Chrome 的瀏覽器助手已離線。請手動開啟專用 Chrome 或重新載入擴充；K 不會自動切換前景。');
 let endpoint;
 try{endpoint=new URL(descriptor.endpoint);}catch{throw Error('K 瀏覽器助手原生連線資料無效。');}
 if(descriptor.version!==1||endpoint.protocol!=='ws:'||endpoint.hostname!=='127.0.0.1'||!endpoint.port||endpoint.pathname!=='/connect'||endpoint.search||endpoint.hash||endpoint.username||endpoint.password||!/^[a-f0-9]{64}$/u.test(descriptor.token??''))throw Error('K 瀏覽器助手原生連線資料無效。');
 const id=randomUUID();
 await new Promise((resolve,reject)=>{
  const socket=new WebSocket(endpoint,{headers:{Authorization:`Bearer ${descriptor.token}`},maxPayload:1024*1024});
  let settled=false;
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);socket.terminate();error?reject(error):resolve();};
  const timer=setTimeout(()=>finish(Error('K 瀏覽器助手背景連線逾時；沒有重送或切換前景視窗。')),timeoutMs);
  socket.on('open',()=>socket.send(JSON.stringify({id,type:'openConnectPage',url})));
  socket.on('message',data=>{
   let message;try{message=JSON.parse(data.toString());}catch{return finish(Error('K 瀏覽器助手回覆格式無效。'));}
   if(message.id!==id)return finish(Error('K 瀏覽器助手回覆不符本次工作。'));
   finish(message.ok===true?undefined:Error('K 瀏覽器助手無法在背景建立連線頁。請確認專用 Chrome 的擴充已啟用；沒有退回前景啟動。'));
  });
  socket.on('error',()=>finish(Error('K 專用 Chrome 的原生連線不可用。請手動開啟專用 Chrome 或重新載入 K 瀏覽器助手；K 不會搶走前景視窗。')));
  socket.on('close',()=>finish(Error('K 瀏覽器助手背景連線已中斷；沒有自動重送。')));
 });
}
