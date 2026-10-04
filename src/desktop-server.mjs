import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createConversationController} from './conversation-controller.mjs';
import {createClaudeLogin} from './claude-login.mjs';
import {createCodexLogin} from './codex-login.mjs';
import {createGeminiLogin} from './gemini-login.mjs';
import {listProjects,addProject,updateProject} from './projects.mjs';
import {pickWorkspaceDirectory} from './workspace-picker.mjs';
import {validateWorkspace} from './workspaces.mjs';
import {createStateStream} from '../shared/state-stream.mjs';
import {createLocalDictation, LocalDictationError, MAX_JSON_BYTES} from './local-dictation.mjs';

export async function startDesktop({root,executable,port=47831,controllerFactory=createConversationController,pickWorkspace=pickWorkspaceDirectory,localDictationFactory=createLocalDictation,claudeLoginFactory=createClaudeLogin,codexLoginFactory=createCodexLogin,geminiLoginFactory=createGeminiLogin,geminiAccounts,coreUpdates,browserRequest,validateProjectWorkspace=validateWorkspace,uiRoot=new URL('../dist-ui/',import.meta.url)}){
 const cookie=randomBytes(32).toString('hex'),clients=new Set(),stateListeners=new Set(),stateStream=createStateStream();let scheduled;
 // Delivery of this one-use URL
 // belongs to the trusted launcher; there is deliberately no HTTP mint route.
 let launchToken=null,launchExpires=0;
 const cookieMatches=req=>req.headers.cookie?.split(';').some(c=>c.trim()===`k_session=${cookie}`);
 const claudeLogin=claudeLoginFactory({cwd:root});
 const codexLogin=codexLoginFactory({cwd:root,executable});
 const geminiLogin=geminiLoginFactory({cwd:root});
 const localDictation=localDictationFactory();
 let localDictationClose=null;
 const closeLocalDictation=()=>{
  if(localDictationClose)return localDictationClose;
  const pending=Promise.resolve().then(()=>localDictation.close());
  let wrapped;
  wrapped=pending.finally(()=>{if(localDictationClose===wrapped)localDictationClose=null;});
  localDictationClose=wrapped;
  return wrapped;
 };
 let closing=false;
 let pickerAbort=null;
 const publicState=()=>{const state=controller.state;return geminiAccounts?.cachedUsage?{...state,usage:{...state.usage,gemini:geminiAccounts.cachedUsage}}:state;};
 const controller=controllerFactory({root,executable,onChange(){
  if(!scheduled)scheduled=setTimeout(()=>{scheduled=null;const state=publicState();for(const listener of stateListeners)listener(state);const event=stateStream.update(state);if(!event)return;const frame=`data: ${JSON.stringify(event)}\n\n`;for(const client of clients)if(!client.destroyed)client.write(frame);},60);
 }});
 const closedResources=new Set();
 let resourceCloseAttempt=null;
 const closeResources=()=>{
  if(resourceCloseAttempt)return resourceCloseAttempt;
  const pending=(async()=>{
  closing=true;
  launchToken=null;pickerAbort?.abort();clearTimeout(scheduled);scheduled=null;
  await coreUpdates?.close();
  const failures=[];
  for(const [name,close] of [['本機語音辨識',closeLocalDictation],['Claude 登入',()=>claudeLogin.close()],['Codex 登入',()=>codexLogin.close()],['對話控制器',()=>controller.close()]]){
   if(closedResources.has(name))continue;
   try{await close();closedResources.add(name);}catch(error){failures.push({name,error});}
  }
  if(failures.length){
   const error=new Error(`K 尚未完全關閉：${failures.map(item=>item.name).join('、')}。程序停止後請重試。`,{cause:failures[0].error});
   error.name='DesktopShutdownError';error.code='K_SHUTDOWN_PARTIAL';error.statusCode=503;error.failures=failures;
   throw error;
  }
  for(const client of clients)client.end();
  })();
  let wrapped;
  wrapped=pending.finally(()=>{if(resourceCloseAttempt===wrapped)resourceCloseAttempt=null;});
  resourceCloseAttempt=wrapped;
  return wrapped;
 };
 let serverClosePromise=null;
 const closeServer=()=>{
  if(serverClosePromise)return serverClosePromise;
  if(!server.listening)return Promise.resolve();
  const pending=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  // Owned work is already settled; do not let renderer HTTP connections keep shutdown alive.
  server.closeAllConnections();
  serverClosePromise=pending.finally(()=>{serverClosePromise=null;});
  return serverClosePromise;
 };
 let origin;
 const server=http.createServer(async(req,res)=>{
  const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  let requestPath='';
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   if(req.headers.host!==new URL(origin).host)return json(403,{error:'Invalid host'});
   const url=new URL(req.url,origin);requestPath=url.pathname;
   if(closing&&!(req.method==='GET'&&['/health','/api/state'].includes(url.pathname))&&!(req.method==='POST'&&url.pathname==='/api/shutdown'))return json(503,{error:'K 正在關閉，請稍後重試。'});
   if(req.method==='GET'&&url.pathname==='/bootstrap'){
    const actual=Buffer.from(url.searchParams.get('token')??''),expected=Buffer.from(launchToken??'');
    if(!launchToken||Date.now()>launchExpires||actual.length!==expected.length||!timingSafeEqual(actual,expected))return json(403,{error:'啟動連結無效或已使用，請重新從桌面開啟。'});
    launchToken=null;launchExpires=0;
    res.writeHead(303,{'Location':'/','Set-Cookie':`k_session=${cookie}; HttpOnly; SameSite=Strict; Path=/`});return res.end();
   }
   if(req.method==='GET'&&url.pathname==='/health')return json(200,{app:'k-harness-desktop',version:1,deployment:'native',workspace:root});
   if(req.method==='GET'&&(url.pathname==='/'||/^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname))){
    if(url.pathname==='/'&&!cookieMatches(req))return json(403,{error:'請從可信桌面入口開啟 K。'});
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':name.endsWith('.jpg')?'image/jpeg':'application/octet-stream';
    const body=await readFile(new URL(name,uiRoot));res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`});return res.end(body);
   }
   if(!cookieMatches(req))return json(403,{error:'請從桌面啟動 K。'});
   if(req.headers.origin&&req.headers.origin!==origin)return json(403,{error:'Cross-origin request denied'});
 if(req.method==='GET'&&url.pathname==='/api/events'){
    if(scheduled){clearTimeout(scheduled);scheduled=null;const pendingEvent=stateStream.update(publicState());if(pendingEvent){const frame=`data: ${JSON.stringify(pendingEvent)}\n\n`;for(const client of clients)if(!client.destroyed)client.write(frame);}}
    res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write(`data: ${JSON.stringify(stateStream.snapshot(publicState()))}\n\n`);clients.add(res);
    const heartbeat=setInterval(()=>res.write(': alive\n\n'),20000);req.on('close',()=>{clearInterval(heartbeat);clients.delete(res);});return;
   }
   if(req.method==='GET'&&url.pathname==='/api/codex/auth')return json(200,await codexLogin.status());
   if(req.method==='GET'&&url.pathname==='/api/gemini/accounts')return json(200,geminiAccounts?await geminiAccounts.list():{enabled:false,activeAccountId:null,busy:false,loginPending:false,accounts:[]});
   if(req.method==='GET'&&url.pathname==='/api/gemini/auth'){
    const managed=await geminiAccounts?.list();
    if(managed?.accounts.length){const row=managed.accounts.find(a=>a.id===managed.activeAccountId);return json(200,{available:true,auth:row?.auth??{status:'unknown'},quota:row?.quota,reason:managed.reason});}
    return json(200,await (geminiAccounts?geminiAccounts.inspect(()=>geminiLogin.status()):geminiLogin.status()));
   }
   if(req.method==='GET'&&url.pathname==='/api/claude/auth')return json(200,await claudeLogin.status());
   if(req.method==='GET'&&url.pathname==='/api/claude/login')return json(200,claudeLogin.progress());
   if(req.method==='GET'&&url.pathname==='/api/sessions')return json(200,await controller.sessions());
   if(req.method==='GET'&&url.pathname==='/api/projects')return json(200,await listProjects(root,(await controller.sessions()).sessions));
   if(req.method==='GET'&&url.pathname==='/api/models')return json(200,await controller.models());
   if(req.method==='GET'&&url.pathname==='/api/state')return json(200,publicState());
   if(req.method==='GET'&&['/api/browser/state','/api/browser/frame','/api/browser/download'].includes(url.pathname)){
    const pageId=url.searchParams.get('pageId'),download=url.pathname==='/api/browser/download',downloadId=url.searchParams.get('id');
    if(download&&!/^[a-f0-9-]{36}$/.test(downloadId??''))throw new Error('下載識別無效。');
    if(pageId&&!/^[A-Za-z0-9-]+$/.test(pageId))throw new Error('瀏覽器分頁識別無效。');
    const threadId=url.searchParams.get('threadId'),session=controller.state.browserAccess?.sessionKey;
    const result=await browserRequest(root,controller.state,threadId,url.pathname.replace('/api/browser','')+(download?`?id=${downloadId}`:pageId?`?pageId=${pageId}`:''));
    if(threadId!==controller.state.threadId||session!==controller.state.browserAccess?.sessionKey)throw new Error('對話已切換。');
    if(result.bytes){res.setHeader('Content-Type',download?'application/octet-stream':'image/jpeg');if(download)res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(result.downloadName)}`);return res.end(result.bytes);}
    return json(200,result);
   }
   if(req.method==='GET'&&url.pathname==='/api/usage'){const refresh=url.searchParams.get('refresh')==='1',usage=await controller.usage(refresh),managed=await geminiAccounts?.usage(false);return json(200,{...usage,...(managed?{gemini:managed}:{})});}
   if(req.method==='GET'&&url.pathname==='/api/directories')return json(200,await controller.directories(url.searchParams.get('path')??undefined));
   if(req.method==='GET'&&['/api/artifact','/api/attachment'].includes(url.pathname)){
    const context={threadId:url.searchParams.get('threadId')};
    const file=url.pathname==='/api/artifact'?await controller.artifact(url.searchParams.get('path'),context):await controller.attachmentFile(url.searchParams.get('id'),context);
    if(url.searchParams.get('download')==='1'){res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.setHeader('Content-Type',file.contentType);return res.end(file.bytes);}
    if(file.contentType.startsWith('image/')){res.setHeader('Content-Type',file.contentType);return res.end(file.bytes);}
    return json(200,{name:file.name,isText:file.isText,text:file.isText?file.bytes.subarray(0,262144).toString('utf8'):null,truncated:file.bytes.length>262144,size:file.bytes.length});
   }
   if(req.method!=='POST'||req.headers['x-k-request']!=='1'||!req.headers['content-type']?.startsWith('application/json'))return json(403,{error:'Explicit local request required'});
   let raw='';const maxBody=url.pathname==='/api/upload'?12*1024*1024:url.pathname==='/api/dictation/transcribe'?MAX_JSON_BYTES:65536;for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>maxBody){if(url.pathname==='/api/dictation/transcribe')throw new LocalDictationError('請求過大。',{code:'REQUEST_TOO_LARGE',statusCode:413});throw new Error('請求過大。');}}const data=JSON.parse(raw||'{}');
   if(url.pathname==='/api/core-update'){
    if(!coreUpdates)throw Error('請從正式桌面入口更新核心。');
    return json(200,await coreUpdates.update(data.provider));
   }
   if(url.pathname==='/api/dictation/transcribe'){
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||typeof data.audioBase64!=='string')
     throw new LocalDictationError('請提供 audioBase64 音訊資料。',{code:'INVALID_REQUEST',statusCode:400});
    const abort=new AbortController();
    const disconnected=()=>{if(!res.writableEnded)abort.abort();};
    res.once('close',disconnected);
    req.once('aborted',disconnected);
    try{
     const result=await localDictation.transcribe(data.audioBase64,{signal:abort.signal});
     if(abort.signal.aborted||res.destroyed)return;
     return json(200,result);
    }finally{res.off('close',disconnected);req.off('aborted',disconnected);}
   }
   if(url.pathname==='/api/browser/action')return json(200,await browserRequest(root,controller.state,data.threadId,'/action',data));
   if(url.pathname==='/api/codex/login')return json(200,await codexLogin.start());
   if(url.pathname.startsWith('/api/gemini/accounts/')){
    const operation={'capture':'capture','login':'startLogin','finish':'finishLogin','cancel':'cancelLogin','activate':'activate','refresh':'refresh'}[url.pathname.slice('/api/gemini/accounts/'.length)];
    if(!operation||!geminiAccounts)throw Error('此版本未提供 Gemini 多帳號操作。');
    const result=await geminiAccounts[operation](data);const event=stateStream.update(publicState());if(event){const frame=`data: ${JSON.stringify(event)}\n\n`;for(const client of clients)if(!client.destroyed)client.write(frame);}return json(200,result);
   }
   if(url.pathname==='/api/gemini/login'){
    if((await geminiAccounts?.list())?.accounts.length)throw Error('請在 Gemini 多帳號區使用加入帳號或重新登入。');
    return json(200,await (geminiAccounts?geminiAccounts.inspect(()=>geminiLogin.start()):geminiLogin.start()));
   }
   if(url.pathname==='/api/codex/login/cancel')return json(200,await codexLogin.cancel());
   if(url.pathname==='/api/claude/login')return json(200,await claudeLogin.start());
   if(url.pathname==='/api/claude/login/cancel')return json(200,await claudeLogin.cancel());
   if(url.pathname==='/api/claude/login/code')return json(200,await claudeLogin.submitCode({code:data.code}));
   if(url.pathname==='/api/pick-workspace'){
    if(pickerAbort)throw new Error('資料夾選擇視窗已開啟，請先完成或取消。');
    if(data.path!==undefined&&typeof data.path!=='string')throw new Error('資料夾路徑無效。');
    const abort=new AbortController();pickerAbort=abort;
    const disconnected=()=>abort.abort();res.once('close',disconnected);
    try {
     const picked=await pickWorkspace({path:data.path??controller.state.workspace??root,signal:abort.signal});
     if(abort.signal.aborted)return;
     if(picked?.cancelled===true)return json(200,{cancelled:true});
     if(picked?.cancelled!==false||typeof picked.path!=='string'||!picked.path)throw new Error('資料夾選擇器未回傳有效結果，請重新選擇。');
     return json(200,{cancelled:false,path:await validateProjectWorkspace(picked.path)});
    }finally{res.off('close',disconnected);if(pickerAbort===abort)pickerAbort=null;}
   }
   if(url.pathname==='/api/projects'){
    const folder=await validateProjectWorkspace(data.path);
    const project=await addProject(root,folder);
    const existing=(await listProjects(root)).projects.find(item=>item.path.toLowerCase()===project.path.toLowerCase());
    if(existing?.archived)return json(200,await updateProject(root,{path:project.path,archived:false}));
    return json(200,project);
   }
   if(url.pathname==='/api/projects/metadata')return json(200,await updateProject(root,data,(await controller.sessions()).sessions));
   if(url.pathname==='/api/attention/read')return json(200,controller.markViewed(data));
   const routes={'/api/fork':'fork','/api/queue':'queue','/api/open':'open','/api/send':'send','/api/steer':'steer','/api/goal':'goal','/api/compact':'compact','/api/stop':'stop','/api/answer':'answer','/api/workers':'workers','/api/upload':'upload','/api/metadata':'metadata','/api/archives/delete':'deleteArchived','/api/workspace':'selectWorkspace','/api/workspace/move':'moveWorkspace','/api/model':'selectModel','/api/native/review':'review','/api/native/files/search':'fuzzyFileSearch'};
   if(routes[url.pathname])return json(200,await controller[routes[url.pathname]](...(!controller.concurrentConversations&&['/api/workers','/api/stop','/api/compact'].includes(url.pathname)?[]:[data])));
   if(url.pathname==='/api/shutdown'){await closeResources();json(200,{closed:true});setTimeout(()=>{void closeServer().catch(()=>{});},100);return;}
   json(404,{error:'Not found'});
  }catch(e){if(!res.headersSent){const status=e.statusCode??400;if(requestPath==='/api/dictation/transcribe'){
    const diagnostic=e instanceof LocalDictationError?e.diagnostic:(e.diagnostic??e.message);
    json(status,{ok:false,error:e instanceof LocalDictationError?e.message:'轉錄要求無法處理。',code:e.code??'INVALID_REQUEST',...(diagnostic?{diagnostic}:{})});}
   else json(status,{error:e.message});}else res.end();}
 });
 server.once('close',()=>{if(!closedResources.has('本機語音辨識'))void closeLocalDictation().catch(()=>{});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{origin=`http://127.0.0.1:${server.address().port}`;resolve();});});
 return {origin,controller,onStateChange(listener){stateListeners.add(listener);listener(publicState());return()=>stateListeners.delete(listener);},onClosed(listener){server.once('close',listener);},createLaunchUrl(){
  launchToken=randomBytes(32).toString('hex');launchExpires=Date.now()+60000;
  return `${origin}/bootstrap?token=${launchToken}`;
 },async close(){await closeResources();await closeServer();}};
}
