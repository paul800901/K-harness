import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';

const require=createRequire(import.meta.url);

// Chrome remains the owner of its tabs and login state. Closing this bridge
// detaches the debugger; it must never close the user's browser or erase data.
export async function createChromeExtensionContext({mode,extensionId,timeoutMs=90000,openConnectPage,protocolFactory,connectBrowser=chromium.connectOverCDP.bind(chromium)}={}){
 if(!['regular','incognito'].includes(mode))throw Error('Choose regular or incognito explicitly.');
 if(!/^[a-p]{32}$/.test(extensionId??''))throw Error('K browser extension identity is invalid.');
 const {ExtensionProtocolV2}=protocolFactory?{}:require('../browser-extension/extension-protocol.cjs');
 const nonce=randomBytes(32).toString('hex'),cdpToken=randomBytes(32).toString('hex');
 const http=createServer((_req,res)=>res.writeHead(404).end());
 const wsServer=new WebSocketServer({noServer:true,maxPayload:32*1024*1024});
 let extension,cdp,browser,closed=false,nextId=0,readyResolve,readyReject;
 const pending=new Map();
 // Extension API events can overtake an earlier command's async response.
 // Playwright installs its Runtime listeners after receiving the frame tree.
 const frameTreeResponses=new Map();
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 void ready.catch(()=>{});
 const sendCommand=(method,params)=>new Promise((resolve,reject)=>{
  if(closed||extension?.readyState!==1)return reject(Error('K browser extension disconnected.'));
  const id=++nextId;pending.set(id,{resolve,reject});extension.send(JSON.stringify({id,method,params}));
 });
 const handler=protocolFactory?protocolFactory(sendCommand):new ExtensionProtocolV2(sendCommand);
 function stop(){
  if(closed)return;closed=true;readyReject(Error('K browser extension disconnected.'));
  for(const item of pending.values())item.reject(Error('K browser extension disconnected.'));pending.clear();
  extension?.terminate();cdp?.terminate();wsServer.close();http.close();
 }
 http.on('upgrade',(req,socket,head)=>{
  const local=['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const extensionRequest=req.url===`/extension/${nonce}`&&req.headers.origin===`chrome-extension://${extensionId}`&&!extension;
  const cdpRequest=req.url===`/cdp/${nonce}`&&req.headers.authorization===`Bearer ${cdpToken}`&&extension&&!cdp;
  if(closed||!local||(!extensionRequest&&!cdpRequest)){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  wsServer.handleUpgrade(req,socket,head,ws=>{
   if(extensionRequest){
    extension=ws;
    ws.on('message',async data=>{
     try{
      const message=JSON.parse(data.toString());
      if(message.id){const item=pending.get(message.id);if(!item)throw Error('Unexpected extension response.');pending.delete(message.id);message.error?item.reject(Error(message.error)):item.resolve(message.result);}
      else await handler.handleExtensionEvent(message.method,message.params);
     }catch{stop();}
    });
    Promise.resolve(handler.ready()).then(readyResolve,readyReject);
   }else{
    cdp=ws;handler.connectOverCDP(message=>{if(ws.readyState===1)ws.send(JSON.stringify(message));});
    ws.on('message',async data=>{
     let message;
     let frameTreeDone;
     try{
      message=JSON.parse(data.toString());
      const {id,method,params,sessionId}=message;
      if(method==='Page.getFrameTree')frameTreeResponses.set(sessionId,new Promise(resolve=>{frameTreeDone=resolve;}));
      if(method==='Runtime.enable')await frameTreeResponses.get(sessionId);
      let result;
      if(method==='Browser.getVersion')result={protocolVersion:'1.3',product:'Chrome/K-Browser-Assistant',userAgent:'K-Extension-Bridge/1'};
      else if(method==='Browser.setDownloadBehavior')result={};
      else {const handled=await handler.handleCDPCommand(method,params,sessionId);result=handled?handled.result:await handler.forwardToExtension(method,params,sessionId);}
      if(ws.readyState===1)ws.send(JSON.stringify({id,sessionId,result}));
     }catch(error){if(message?.id&&ws.readyState===1)ws.send(JSON.stringify({id:message.id,sessionId:message.sessionId,error:{message:error.message}}));else stop();}
     finally{frameTreeDone?.();if(message?.method==='Runtime.enable')frameTreeResponses.delete(message.sessionId);}
    });
   }
   ws.on('close',stop);ws.on('error',stop);
  });
 });
 const timer=setTimeout(()=>{readyReject(Error('K 與 Chrome 擴充連線逾時，尚未開始操作網頁。請查看擴充連線頁的錯誤；沒有自動重試。'));stop();},timeoutMs);
 try{
  await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve);});
  const host=`127.0.0.1:${http.address().port}`;
  const connectUrl=new URL(`chrome-extension://${extensionId}/connect.html`);
  connectUrl.searchParams.set('mcpRelayUrl',`ws://${host}/extension/${nonce}`);
  connectUrl.searchParams.set('client',JSON.stringify({name:`K 瀏覽器助手 · ${mode==='incognito'?'無痕':'一般'}`}));
  connectUrl.searchParams.set('protocolVersion','2');connectUrl.searchParams.set('mode',mode);connectUrl.searchParams.set('newTab','true');
  if(openConnectPage)await openConnectPage(connectUrl.toString());
  else throw Error('K 需要瀏覽器助手的背景連線；不會以命令列啟動 Chrome 或切換前景。');
  await ready;
  browser=await connectBrowser(`ws://${host}/cdp/${nonce}`,{headers:{Authorization:`Bearer ${cdpToken}`},noDefaults:true,isLocal:true,timeout:15000});
  browser.on('disconnected',stop);
  const context=browser.contexts()[0];if(!context)throw Error('Extension did not provide a browser context.');
  // Chrome permits a data URL as a new top-level tab, but rejects navigating
  // an existing tab to it through extension debugger Page.navigate. Keep the
  // real opaque data origin; do not substitute setContent or an HTTP page.
  context.openDataPage=async url=>{
   if(typeof url!=='string'||!/^data:/iu.test(url))throw Error('A data URL is required.');
   url=new URL(url).href;
   const pageReady=context.waitForEvent('page',{timeout:10000});
   void pageReady.catch(()=>{});
   await handler.handleCDPCommand('Target.createTarget',{url});
   const page=await pageReady;
   await page.waitForURL(url,{timeout:10000,waitUntil:'domcontentloaded'});
   return page;
  };
  context.close=async()=>{try{await browser.close();}finally{stop();}};
  return context;
 }catch(error){stop();throw error;}finally{clearTimeout(timer);}
}


