// Real K frontend and native views, fake controller/pages only, no model/account.
const electron=require('electron');
const {app}=electron;
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdir,writeFile,readFile,readdir}=require('node:fs/promises');
const {createServer}=require('node:http');
const assert=require('node:assert/strict');
const root=process.env.K_ELECTRON_PILOT_ROOT;
if(!root||!path.isAbsolute(root)||!process.send)throw Error('Explicit fake-data root and private launcher required.');
app.setPath('userData',path.join(root,'workbench-host'));
// A failing automated candidate must fail its test, not leave a modal error
// dialog on the user's desktop. Preserve the exception and exit unsuccessfully.
process.once('uncaughtException',error=>{
 const result={scope:'fake-controller-local-pages-only',status:'failed',productionChanged:false,error:error.stack};
 require('node:fs').writeFileSync(path.join(root,`uncaught-workbench-${Date.now()}.json`),JSON.stringify(result,null,2));
 process.send({type:'result',result},()=>app.exit(1));
});
const transport={send:message=>process.send({type:'cdp-send',message}),close(){this.onclose?.();}};
process.on('message',message=>{if(message.type==='cdp-receive')transport.onmessage?.(message.message);});
process.on('disconnect',()=>app.exit(1));app.on('window-all-closed',()=>{});
const moduleAt=file=>import(pathToFileURL(path.resolve(file)).href);
app.whenReady().then(async()=>{
 const result={scope:'fake-controller-local-pages-only',checks:[],productionChanged:false};
 let browser,workbench,site,registry,ui,aiConfig;
 const step=name=>process.send({type:'progress',name});
 try{
  const {chromium}=await import('playwright');
  const {createElectronWorkbench}=await moduleAt('src/electron-workbench.mjs');
  const {startDesktop}=await moduleAt('src/desktop-server.mjs');
  const {createOwnerBrowserRegistry}=await moduleAt('src/owner-browser-registry.mjs');
  const run=path.join(root,`workbench-${Date.now()}`),profiles=path.join(run,'profiles'),outputs=path.join(run,'outputs');
  for(const directory of [run,profiles,outputs])await mkdir(directory,{recursive:true});
  site=createServer((req,res)=>{
   if(req.url==='/download'){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="native-fake.txt"'});res.end('K_NATIVE_FAKE_DOWNLOAD');return;}
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url==='/popup'?'<title>假登入</title><button onclick="document.cookie=\'fake_native_login=ok; path=/; SameSite=Lax; Max-Age=3600\';window.opener.postMessage(\'K_FAKE_LOGIN_DONE\',location.origin);window.close()">完成假登入</button>':'<title>原生網頁假資料</title><script>addEventListener("message",e=>{if(e.origin===location.origin)window.fakeLoginReply=e.data;})</script><h1>真正網頁，不是截圖</h1><input aria-label="假資料欄位" id="text"><button id="mcp-hidden-click" onclick="document.querySelector(\'#mcp-hidden-result\').textContent=\'MCP_HIDDEN_CLICK_OK\'">MCP hidden click</button><output id="mcp-hidden-result">not-clicked</output><button onclick="window.open(\'/popup\')">假登入彈窗</button><a href="/download">下載假檔案</a><p>可直接點擊、輸入與捲動。</p><div style="height:1800px;background:linear-gradient(#fff,#bdf)">捲動內容</div>');});
  await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${site.address().port}/`;
  browser=await chromium.connectOverCDP(transport,{noDefaults:true,timeout:15000});
  browser.contexts()[0].setDefaultTimeout(10000);browser.contexts()[0].setDefaultNavigationTimeout(15000);
  const threadId='native-fake-conversation';
  const state={status:'ready',threadId,provider:'codex',model:'gpt-6-sol',modelDisplayName:'假資料驗證',title:'原生瀏覽器候選驗證',workspace:run,
   browserAccess:{enabled:true,networkAccess:true,sessionKey:threadId},messages:[],tools:[],workers:[],artifacts:[],turnDiffs:[],questions:[],notices:[],reasoning:[],modelChanges:[],
   accessMode:'workspace-write',usage:{codex:{status:'unavailable',windows:[]},claude:{status:'unavailable',windows:[]},flash:{totalTokens:0,responses:0,unconfirmed:0,pending:0}},
   progress:{plan:[],explanation:null,compaction:'idle',compactions:0,tokenUsage:null},capabilities:{},busy:false};
  workbench=await createElectronWorkbench({electron,browser,servicesFactory:async({gatewayFactory})=>{
   registry=createOwnerBrowserRegistry({vault:profiles,outputRoot:outputs,gatewayFactory});
   aiConfig=await registry.session().config({conversationId:threadId,provider:'codex',accessMode:'workspace-write'});
   const controller={state,concurrentConversations:true,async sessions(){return {sessions:[{threadId,title:state.title,workspace:run,model:state.model,provider:'codex',accessMode:state.accessMode,busy:false}],unreadable:0};},async usage(){return state.usage;},async close(){}};
   const login=()=>({async close(){}});
   const desktop=await startDesktop({root:run,executable:'fake-no-model',port:0,requireLaunchToken:true,controllerFactory:()=>controller,browserRequest:registry.request,claudeLoginFactory:login,codexLoginFactory:login,uiRoot:pathToFileURL(path.resolve('.runtime/electron-native-ui')+path.sep)});
   return {browsers:registry,app:{...desktop,async close(){await desktop.close();await registry.close();}}};
  }});
  const callConfig=async(config,message)=>{
   const response=await fetch(config.url,{method:'POST',headers:{...config.http_headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify(message),signal:AbortSignal.timeout(20000)});
   assert.equal(response.status,200);const body=await response.text();return JSON.parse(body.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n')||body);
  };
  const rpc=message=>callConfig(aiConfig,message);
  if(process.env.K_SKIP_FIRST_HIDDEN_PAGE_PROBE!=='1'){
  // Regression: the first target is never presented before MCP navigate,
  // resize and locator click. The old pilot only exercised show-then-hide.
  const backgroundThread='background-fake-conversation',backgroundState={...state,threadId:backgroundThread,browserAccess:{...state.browserAccess,sessionKey:backgroundThread}};
  const backgroundSession=registry.session(),backgroundConfig=await backgroundSession.config({conversationId:backgroundThread,provider:'codex',accessMode:'workspace-write'});
  let earlyRpcId=100;
  const earlyRpc=message=>callConfig(backgroundConfig,message);
  await earlyRpc({jsonrpc:'2.0',id:earlyRpcId++,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'native-hidden-page-regression',version:'1'}}});
  await earlyRpc({jsonrpc:'2.0',id:earlyRpcId++,method:'tools/call',params:{name:'browser_snapshot',arguments:{}}});
  const firstHidden=await registry.presentation(backgroundState,backgroundThread,null);assert(firstHidden.page);
  assert.equal(firstHidden.page.url(),'about:blank','Regression must begin on the first never-navigated target');
  const firstView=workbench.window.contentView.children.find(view=>view.webContents?.getURL?.()==='about:blank');assert(firstView);
  assert(workbench.window.contentView.children.indexOf(firstView)<workbench.window.contentView.children.indexOf(workbench.owner),'First browser view must remain beneath the owner UI without views.show');
  const earlyCall=async(name,args={})=>{
   const reply=await earlyRpc({jsonrpc:'2.0',id:earlyRpcId++,method:'tools/call',params:{name,arguments:args}});
   assert(!reply.error&&!reply.result?.isError,JSON.stringify(reply));return reply.result;
  };
  await earlyCall('browser_navigate',{url});
  await earlyCall('browser_resize',{width:1280,height:720});
  await earlyCall('browser_click',{target:'button:has-text("MCP hidden click")'});
  assert.equal(firstHidden.page.url(),url);
  const firstViewport=await firstHidden.page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  assert.deepEqual(firstViewport,{width:1280,height:720});
  await firstHidden.page.waitForFunction(()=>document.querySelector('#mcp-hidden-result')?.textContent==='MCP_HIDDEN_CLICK_OK',null,{timeout:10000});
  assert(workbench.window.contentView.children.indexOf(firstView)<workbench.window.contentView.children.indexOf(workbench.owner),'MCP actions must not implicitly present the first target');
  result.checks.push('First never-shown WebContentsView accepts official MCP navigate, resize and click');
  await backgroundSession.close();
  }
  await rpc({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'native-ui-regression',version:'1'}}});
  ui=browser.contexts()[0].pages().find(page=>page.url().startsWith(workbench.services.app.origin));assert(ui);step('native workbench loaded');
  step(`window visible at start: ${workbench.window.isVisible()}`);
  const errors=[];ui.on('pageerror',error=>errors.push(error.message));
  let frames=0;ui.on('request',request=>{if(request.url().includes('/api/browser/frame'))frames++;});
  await ui.getByRole('heading',{name:state.title}).waitFor();
  const firstAiPage=await rpc({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'browser_navigate',arguments:{url}}});
  assert(!firstAiPage.error&&!firstAiPage.result?.isError,JSON.stringify(firstAiPage));
  await ui.locator('[data-native-browser-viewport]:visible').waitFor();
  result.checks.push('First AI navigation automatically opens the real page in the right panel');
  const address=ui.getByRole('textbox',{name:'瀏覽器網址'});await address.fill(url);await address.press('Enter');
  step('address submitted');
  await ui.locator('[data-native-browser-viewport]').waitFor();
  await ui.waitForFunction(()=>document.querySelector('[data-native-browser-viewport]')?.getBoundingClientRect().height>100);
  const presentation=await registry.presentation(state,threadId,null),page=presentation.page;assert(page);
  await page.waitForURL(url,{timeout:15000});
  await ui.waitForFunction(()=>{const button=document.querySelector('.browser-release');return button&&!button.disabled;});
  await page.getByRole('textbox',{name:'假資料欄位'}).fill('K_NATIVE_REAL_INPUT');
  step('native page input');
  assert.equal(await page.locator('#text').inputValue(),'K_NATIVE_REAL_INPUT');
  result.checks.push('Real K React frontend presents native browser; no screenshot polling');assert.equal(frames,0);
  result.checks.push('Native input updates same owned page');
  // Electron createWindow supplies an owned native View; Chromium need not
  // report its opener relationship as Playwright's Page "popup" event.
  const popupPromise=browser.contexts()[0].waitForEvent('page',{timeout:10000,predicate:async candidate=>{try{await candidate.waitForURL(url+'popup',{timeout:5000});return true;}catch{return false;}}});await page.getByRole('button',{name:'假登入彈窗'}).click();const popup=await popupPromise;
  step(`window visible before popup close: ${workbench.window.isVisible()}`);
  step(`popup close implementation: ${await popup.evaluate(()=>window.close.toString())}`);
  const popupClosed=popup.waitForEvent('close',{timeout:10000});await popup.getByRole('button',{name:'完成假登入'}).click();await popupClosed;
  step('popup closed');
  assert.equal(workbench.window.isVisible(),true,'Closing a website popup must not hide K');
  assert.match(await page.evaluate(()=>document.cookie),/fake_native_login=ok/);await page.waitForFunction(()=>window.fakeLoginReply==='K_FAKE_LOGIN_DONE');result.checks.push('Native popup fake login shares session');
  await page.getByRole('link',{name:'下載假檔案'}).click();
  const waitUntil=async(check)=>{const deadline=Date.now()+7000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Candidate condition timed out.');};
  let download;
  await waitUntil(async()=>{download=(await registry.request(null,state,threadId,'/state')).downloads.find(d=>d.name==='native-fake.txt');return download?.status==='completed'||download?.status==='failed';});
  assert.equal(download.status,'completed',JSON.stringify(download));assert.equal(download.zoneMarked,true);
  const downloaded=await registry.request(null,state,threadId,`/download?id=${download.id}`);
  assert.equal(Buffer.from(downloaded.bytes).toString(),'K_NATIVE_FAKE_DOWNLOAD');
  assert.equal((await readdir(path.join(profiles,threadId,'native-download-staging'))).filter(name=>name.endsWith('.download')).length,1);
  result.checks.push('Native download safely saved, listed, read back and Windows Zone marked');
  await ui.getByRole('button',{name:'交回 AI',exact:true}).click();
  const control=(await registry.presentation(state,threadId,null)).control;assert.equal(control.humanInputAllowed,false);
  result.checks.push('Return-to-AI synchronously locks native human input');
  const clicked=await rpc({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'browser_click',arguments:{target:'a[href="/download"]'}}});
  assert(!clicked.error&&!clicked.result?.isError,JSON.stringify(clicked));
  await waitUntil(async()=>{const list=(await registry.request(null,state,threadId,'/state')).downloads;return list.filter(item=>item.status==='completed').length===2;});
  result.checks.push('Official MCP download click completes through native download ownership');
  const native=electron.webContents.getAllWebContents().find(w=>w.getURL()===url);assert(native);
  const guard=workbench.window.contentView.children.at(-1);assert.notEqual(guard.webContents,native);
  guard.webContents.sendInputEvent({type:'mouseDown',x:12,y:12,button:'left',clickCount:1});
  guard.webContents.sendInputEvent({type:'mouseUp',x:12,y:12,button:'left',clickCount:1});
  await waitUntil(()=>registry.controlSnapshot(state,threadId).humanInputAllowed);
  assert.equal(workbench.window.contentView.children.at(-1).webContents,native);
  const box=await page.locator('#text').boundingBox(),nativeZoom=native.getZoomFactor();native.focus();
  native.sendInputEvent({type:'mouseDown',x:Math.round((box.x+10)*nativeZoom),y:Math.round((box.y+10)*nativeZoom),button:'left',clickCount:1});
  native.sendInputEvent({type:'mouseUp',x:Math.round((box.x+10)*nativeZoom),y:Math.round((box.y+10)*nativeZoom),button:'left',clickCount:1});
  await native.insertText('原生鍵盤測試');assert.match(await page.locator('#text').inputValue(),/原生鍵盤測試/);
  native.sendInputEvent({type:'mouseWheel',x:100,y:200,deltaX:0,deltaY:-500});await page.waitForFunction(()=>scrollY>0);
  // Native smooth scrolling may continue after the first nonzero frame.
  await page.waitForFunction(()=>{const y=scrollY;const now=performance.now();if(window.__lastScrollY!==y){window.__lastScrollY=y;window.__lastScrollTime=now;return false;}return now-window.__lastScrollTime>250;});
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForFunction(()=>scrollY===0);
  result.checks.push('Native mouse takeover, direct text insertion and wheel scroll');
  assert.equal(await page.evaluate(()=>typeof window.kBrowser),'undefined');
  result.checks.push('Browser web content has no owner preload bridge');
  const nativeAttached=()=>{const layers=workbench.window.contentView.children;return layers.findIndex(view=>view.webContents===native)>layers.indexOf(workbench.owner);};
  await ui.getByRole('button',{name:'新增工作面板'}).click();
  await ui.getByRole('menuitem',{name:'子代理'}).waitFor();await waitUntil(()=>!nativeAttached());
  await ui.getByRole('button',{name:'新增工作面板'}).click();await waitUntil(nativeAttached);
  await ui.getByRole('button',{name:'操作權限',exact:true}).click();
  await ui.getByRole('menu',{name:'操作權限選單'}).waitFor();await waitUntil(()=>!nativeAttached());
  await ui.keyboard.press('Escape');await waitUntil(nativeAttached);
  result.checks.push('Owner panel menu and permission popover hide native surface; closing restores it');
  await ui.getByRole('button',{name:'切換工具與成果面板'}).click();await waitUntil(()=>!nativeAttached());
  await registry.request(null,state,threadId,'/action',{type:'release'});
  const hiddenPopupPromise=browser.contexts()[0].waitForEvent('page',{timeout:10000,predicate:async candidate=>{try{await candidate.waitForURL(url+'popup',{timeout:5000});return true;}catch{return false;}}});
  const hiddenClick=await rpc({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'browser_click',arguments:{target:'button:has-text("假登入彈窗")'}}});
  assert(!hiddenClick.error&&!hiddenClick.result?.isError,JSON.stringify(hiddenClick));
  const hiddenPopup=await hiddenPopupPromise;
  await ui.getByRole('tab',{name:/假登入/}).waitFor();await ui.getByRole('tab',{name:/假登入/}).click();
  const hiddenWc=electron.webContents.getAllWebContents().find(w=>w.getURL()===url+'popup');
  await waitUntil(()=>workbench.window.contentView.children.findIndex(view=>view.webContents===hiddenWc)>workbench.window.contentView.children.indexOf(workbench.owner));
  const hiddenClosed=hiddenPopup.waitForEvent('close',{timeout:10000});await hiddenPopup.getByRole('button',{name:'完成假登入'}).click();await hiddenClosed;
  await waitUntil(nativeAttached);
  result.checks.push('Popup opened while panel is hidden becomes a real selectable tab; closing returns to parent');
  const lifecycleEvents={resize:0,minimize:0,restore:0};for(const event of Object.keys(lifecycleEvents))workbench.window.on(event,()=>lifecycleEvents[event]++);
  const beforeMinimize={visible:workbench.window.isVisible(),minimized:workbench.window.isMinimized(),attached:nativeAttached(),threadId:state.threadId,url:await page.url(),title:await page.title(),input:await page.locator('#text').inputValue(),cookie:await page.evaluate(()=>document.cookie),zoom:native.getZoomFactor(),control:registry.controlSnapshot(state,threadId)};
  workbench.window.minimize();await waitUntil(()=>workbench.window.isMinimized());await new Promise(resolve=>setTimeout(resolve,250));
  const whileMinimized={visible:workbench.window.isVisible(),minimized:workbench.window.isMinimized(),attached:nativeAttached()};
  workbench.window.restore();workbench.window.focus();await waitUntil(()=>!workbench.window.isMinimized()&&workbench.window.isVisible());await new Promise(resolve=>setTimeout(resolve,500));
  const restoredPresentation=await registry.presentation(state,threadId,null);
  const afterRestore={visible:workbench.window.isVisible(),minimized:workbench.window.isMinimized(),attached:nativeAttached(),threadId:state.threadId,samePage:restoredPresentation.page===page,url:await page.url(),title:await page.title(),input:await page.locator('#text').inputValue(),cookie:await page.evaluate(()=>document.cookie),zoom:native.getZoomFactor(),control:registry.controlSnapshot(state,threadId),dom:await page.locator('body').innerText()};
  const pageImage=await native.capturePage(),pageImageSize=pageImage.getSize(),pageBitmap=pageImage.toBitmap();let nonBlackPixels=0;for(let i=0;i<pageBitmap.length;i+=4)if(pageBitmap[i]>8||pageBitmap[i+1]>8||pageBitmap[i+2]>8)nonBlackPixels++;
  afterRestore.pageCapture={width:pageImageSize.width,height:pageImageSize.height,nonBlackPixels,totalPixels:pageBitmap.length/4};await writeFile(path.join(run,'native-after-minimize-restore.png'),pageImage.toPNG());
  const restoreSources=await electron.desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1440,height:960}}),restoreWindow=restoreSources.find(source=>source.id===workbench.window.getMediaSourceId());assert(restoreWindow&&!restoreWindow.thumbnail.isEmpty(),'Restored native window must yield a composed screenshot');const windowRestoreImage=restoreWindow.thumbnail.toPNG();await writeFile(path.join(run,'window-after-minimize-restore.png'),windowRestoreImage);afterRestore.windowCapture={bytes:windowRestoreImage.length,size:restoreWindow.thumbnail.getSize(),sha256:require('node:crypto').createHash('sha256').update(windowRestoreImage).digest('hex')};
  assert.equal(afterRestore.attached,true,'Browser view must re-present after native restore');assert.equal(afterRestore.samePage,true,'Restore must keep the same owned Page');assert.equal(afterRestore.url,beforeMinimize.url);assert.equal(afterRestore.input,beforeMinimize.input);assert.equal(afterRestore.cookie,beforeMinimize.cookie);assert.equal(afterRestore.zoom,beforeMinimize.zoom);assert.equal(afterRestore.threadId,beforeMinimize.threadId);assert.equal(afterRestore.control.humanInputAllowed,beforeMinimize.control.humanInputAllowed);assert.equal(lifecycleEvents.restore,1);
  result.minimizeRestore={before:beforeMinimize,whileMinimized,after:afterRestore,lifecycleEvents};result.checks.push('Native BaseWindow minimize/restore re-presents the same fake page without changing URL, input, cookie, zoom, conversation or input lock');
  workbench.window.close();assert.equal(workbench.window.isVisible(),false);await waitUntil(()=>!nativeAttached());
  workbench.show();await waitUntil(nativeAttached);assert.equal(workbench.window.isVisible(),true);
  result.checks.push('Closing and reopening the native window restores the same browser page');
  for(const width of [1000,1920]){
   if(workbench.window.isMaximized()){workbench.window.unmaximize();await waitUntil(()=>!workbench.window.isMaximized());}
   workbench.window.setContentSize(width,900);
   await ui.waitForFunction(w=>innerWidth===w,width);await waitUntil(nativeAttached);
   const viewport=await ui.locator('[data-native-browser-viewport]:visible').boundingBox();
   const actual=workbench.window.contentView.children.find(view=>view.webContents===native).getBounds();
   assert(Math.abs(actual.x-viewport.x)<=1&&Math.abs(actual.width-viewport.width)<=1);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const shots=await electron.desktopCapturer.getSources({types:['window'],thumbnailSize:{width,height:960}});
   const shot=shots.find(source=>source.id===workbench.window.getMediaSourceId());assert(shot&&!shot.thumbnail.isEmpty());
   await writeFile(path.join(run,`native-workbench-${width}.png`),shot.thumbnail.toPNG());
  }
  result.checks.push('Native surface follows visible panel bounds at 1000 and 1920 pixels');
  assert.deepEqual(errors,[]);await writeFile(path.join(run,'owner-ui.png'),(await workbench.owner.webContents.capturePage()).toPNG());
  await writeFile(path.join(run,'native-page.png'),(await electron.webContents.getAllWebContents().find(w=>w.getURL()===url).capturePage()).toPNG());
  const sources=await electron.desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1440,height:960}});
  const ownWindow=sources.find(source=>source.id===workbench.window.getMediaSourceId());
  if(ownWindow&&!ownWindow.thumbnail.isEmpty())await writeFile(path.join(run,'native-workbench-window.png'),ownWindow.thumbnail.toPNG());
  result.evidence=run;result.status='native-workbench-candidate-pass-not-production-ready';
 }catch(error){result.status='failed';result.error=error.stack;try{
  step(`test failed: ${error.message}`);
  result.uiText=await ui?.locator('body').innerText({timeout:2000});
  result.uiGeometry=await ui?.evaluate(()=>({width:innerWidth,height:innerHeight,buttons:[...document.querySelectorAll('button[aria-label="切換工具與成果面板"],input[aria-label="瀏覽器網址"]')].map(e=>({rect:e.getBoundingClientRect().toJSON(),display:getComputedStyle(e).display,disabled:e.disabled}))}));
  if(workbench)await writeFile(path.join(root,'failed-workbench.png'),(await workbench.owner.webContents.capturePage()).toPNG());
 }catch{}}
 finally{
  for(const [name,cleanup] of [['workbench',()=>workbench?.close()],['registry',()=>registry?.close()],['browser',()=>browser?.close()],['renderers',()=>{for(const wc of electron.webContents.getAllWebContents())if(!wc.isDestroyed())wc.close();}],['fake site',()=>site&&new Promise(resolve=>site.close(resolve))]]){
   let timer;try{await Promise.race([cleanup(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Shutdown timed out: ${name}`)),5000);})]);}catch(error){(result.shutdownErrors??=[]).push(error.message);}finally{clearTimeout(timer);}
  }
  await writeFile(path.join(root,`workbench-result-${Date.now()}.json`),JSON.stringify(result,null,2));process.send({type:'result',result});app.exit(result.status==='failed'||result.shutdownErrors?1:0);
 }
});
