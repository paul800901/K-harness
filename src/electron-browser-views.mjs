import path from 'node:path';
import {EventEmitter} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {createElectronScopedContext} from './electron-scoped-context.mjs';
import {prepareNativeDownloads} from './electron-download.mjs';

const NETWORK_PROTOCOLS=new Set(['http:','https:','ws:','wss:']);

// blockedOrigins remains accepted for existing callers. Its explicit ports are
// promoted to protected ports so loopback aliases (or another hostname) cannot
// reach a trusted local endpoint through this browser session.
export function createElectronBrowserUrlGuard({blockedOrigins=[],blockedPorts=[]}={}){
 const origins=new Set(),ports=new Set();
 for(const value of blockedOrigins){
  try{
   const parsed=new URL(value);
   if(!NETWORK_PROTOCOLS.has(parsed.protocol))continue;
   origins.add(parsed.origin);
   if(parsed.port)ports.add(parsed.port);
  }catch{}
 }
 for(const value of blockedPorts){
  const port=String(value);
  if(!/^\d{1,5}$/u.test(port)||Number(port)<1||Number(port)>65535)throw new TypeError(`Invalid protected browser port: ${port}`);
  ports.add(String(Number(port)));
 }
 const isProtected=parsed=>NETWORK_PROTOCOLS.has(parsed.protocol)&&(
  ports.has(parsed.port)||origins.has(parsed.origin)
 );
 return value=>{
  let parsed;
  try{parsed=new URL(value);}catch{return false;}
  if(parsed.username||parsed.password)return false;
  if(NETWORK_PROTOCOLS.has(parsed.protocol))return !isProtected(parsed);
  if(parsed.protocol==='blob:'){
   // A blob URL inherits the creator's origin; inspect that source explicitly.
   // Opaque/malformed sources are denied rather than treated as unprotected.
   try{
    const source=new URL(parsed.href.slice('blob:'.length));
    return NETWORK_PROTOCOLS.has(source.protocol)&&!source.username&&!source.password&&!isProtected(source);
   }catch{return false;}
  }
  // Preserve the prior candidate support for local/inline document URLs.
  return parsed.protocol==='about:'||parsed.protocol==='data:';
 };
}

// Candidate only. The raw CDP context stays in the trusted owner process.
// Never pass it, or its debugging endpoint, to a model or a renderer.
export function createElectronBrowserViews({electron,window,browser,blockedOrigins=[],onPageActivated=()=>{},onPageClosed=()=>{}}){
 const {WebContentsView,session,webContents}=electron;
 const raw=browser.contexts()[0],scopes=new Map(),pageOwners=new WeakMap(),classifying=new WeakMap();
 let current=null,bounds={x:0,y:0,width:800,height:600},overlay=null,showGeneration=0;
 // Hidden conversation tabs must keep animation frames for Playwright's
 // visibility/stability checks; hiding a panel must not stall the AI's work.
 const preferences={sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:false,webSecurity:true,backgroundThrottling:false};
 const allowed=createElectronBrowserUrlGuard({blockedOrigins});
 const currentScope=()=>[...scopes.values()].find(scope=>scope.views.has(current?.webContents.id));
 const fitView=(view,rect)=>{
  const viewport=view.kViewport;
  if(!viewport){view.setBounds(rect);return;}
  const scale=Math.min(rect.width/viewport.width,rect.height/viewport.height,1);
  const width=Math.max(1,Math.round(viewport.width*scale)),height=Math.max(1,Math.round(viewport.height*scale));
  view.setBounds({x:rect.x+Math.floor((rect.width-width)/2),y:rect.y+Math.floor((rect.height-height)/2),width,height});
  // Use Chromium's native page zoom rather than device-emulation scale:
  // emulation scale misaligns Playwright's locator hit tests on embedded views.
  view.webContents.setZoomMode('isolated');
  view.webContents.setZoomFactor(scale);
 };
 const syncInput=()=>{
  if(!current||currentScope()?.humanAllowed){
   if(overlay&&window.contentView.children.includes(overlay))window.contentView.removeChildView(overlay);
   return;
  }
  if(!overlay){
   overlay=new WebContentsView({webPreferences:{...preferences,partition:'k-browser-input-guard'}});
   overlay.setBackgroundColor('#00000000');
   void overlay.webContents.loadURL('data:text/html,<style>html,body{margin:0;width:100%;height:100%;background:transparent;cursor:pointer}</style>').catch(()=>{});
   const request=event=>{event.preventDefault();const scope=currentScope();if(scope&&!scope.requestingTakeover){scope.requestingTakeover=true;Promise.resolve().then(()=>scope.takeover?.()).catch(()=>{}).finally(()=>{scope.requestingTakeover=false;});}};
   overlay.webContents.on('before-mouse-event',(event,input)=>{if(input.type==='mouseDown')request(event);});
   overlay.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown')request(event);});
  }
  overlay.setBounds(bounds);window.contentView.addChildView(overlay);
  // A previously focused native page must not retain keyboard input on release.
  if(current.webContents.isFocused())overlay.webContents.focus();
 };
 function installView(scope,view){
  const wc=view.webContents;
  // Apply to the newly created renderer too, including a page first opened
  // behind the owner UI (before it has ever been presented to the user).
  wc.on('dom-ready',()=>wc.setBackgroundThrottling(false));
  // Background AI tabs also need a usable layout before the user opens a panel.
  view.setBounds({x:0,y:0,width:1024,height:768});
  // Detached native views stop animation frames even with throttling disabled.
  // Keep inactive views underneath the opaque owner UI, never above it.
  window.contentView.addChildView(view,0);
  scope.views.set(wc.id,view);
  wc.on('destroyed',()=>{
   scope.views.delete(wc.id);
   if(current===view){
    current=null;syncInput();
    const parentView=scope.popups.get(wc.id);
    const parent=[...scope.pages].find(page=>pageOwners.get(page)?.wc===parentView?.webContents&&!page.isClosed());
    if(parent&&!scope.closing)void show(parent).then(shown=>{if(shown)onPageActivated(parent,'popup-return');}).catch(()=>{});
   }
   scope.popups.delete(wc.id);
  });
  wc.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
  wc.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});
  const reportNavigation=()=>{
   const page=[...scope.pages].find(candidate=>pageOwners.get(candidate)?.wc===wc&&!candidate.isClosed());
   if(page)onPageActivated(page,'navigate');
  };
  wc.on('did-navigate',reportNavigation);
  wc.on('did-navigate-in-page',reportNavigation);
  wc.setWindowOpenHandler(({url})=>{
   if(!allowed(url))return {action:'deny'};
   return {action:'allow',overrideBrowserWindowOptions:{webPreferences:{...preferences,session:scope.session}},createWindow:options=>{
    // Electron has already created the popup contents. Replacing it with a
    // fresh WebContents disconnects the opener and triggers a main-process error.
    const popup=new WebContentsView({webContents:options.webContents,webPreferences:{...options.webPreferences,...preferences,session:scope.session}});
    installView(scope,popup);scope.popups.set(popup.webContents.id,view);
    return popup.webContents;
   }};
  });
  return view;
 }
 async function classifyPage(page){
  if(page.isClosed())return null;
  if(pageOwners.has(page))return pageOwners.get(page);
  const cdp=await raw.newCDPSession(page);
  let target;
  try{target=(await cdp.send('Target.getTargetInfo')).targetInfo;}catch(error){await cdp.detach().catch(()=>{});throw error;}
  const wc=webContents.fromDevToolsTargetId(target.targetId);
  const scope=[...scopes.values()].find(item=>item.session===wc?.session&&item.views.has(wc.id));
  if(!scope){await cdp.detach();return null;}
  await cdp.detach();
  pageOwners.set(page,{scope,wc});scope.pages.add(page);
  const viewportSize=page.viewportSize.bind(page);
  page.viewportSize=()=>scope.views.get(wc.id)?.kViewport??viewportSize();
  const screenshot=page.screenshot.bind(page);
  page.screenshot=async(options={})=>{
   const zoom=wc.getZoomFactor();
   if(zoom===1)return screenshot(options);
   // Playwright's CDP capture uses native (zoomed) coordinates, while its
   // default rectangle comes from CSS layout dimensions. Keep native zoom
   // for input hit testing; convert only the capture rectangle.
   const layout=await page.evaluate(fullPage=>{
    const width=fullPage?Math.max(document.documentElement.scrollWidth,document.documentElement.offsetWidth,document.documentElement.clientWidth,document.body?.scrollWidth??0,document.body?.offsetWidth??0,document.body?.clientWidth??0):innerWidth;
    const height=fullPage?Math.max(document.documentElement.scrollHeight,document.documentElement.offsetHeight,document.documentElement.clientHeight,document.body?.scrollHeight??0,document.body?.offsetHeight??0,document.body?.clientHeight??0):innerHeight;
    return {x:0,y:0,width,height,scrollX,scrollY};
   },!!options.fullPage);
   const clip=options.clip??layout;
   // Use document coordinates so Playwright does not add an unscaled scroll
   // offset from the deprecated CDP visualViewport metrics after this conversion.
   const physicalClip={x:Math.round((clip.x+(options.fullPage?0:layout.scrollX))*zoom),y:Math.round((clip.y+(options.fullPage?0:layout.scrollY))*zoom),width:Math.max(1,Math.round(clip.width*zoom)),height:Math.max(1,Math.round(clip.height*zoom))};
   if(options.scale!=='css')return screenshot({...options,fullPage:true,clip:physicalClip});
   const format=options.type??({'.jpg':'jpeg','.jpeg':'jpeg','.webp':'webp'}[path.extname(options.path??'').toLowerCase()]??'png');
   if(!['png','jpeg','webp'].includes(format))throw Error(`Unsupported screenshot format: ${format}`);
   // Native zoom quantizes capture bounds to physical pixels. Capture losslessly
   // with Playwright's normal preparation, then normalize to the requested CSS
   // size. A detached canvas in an isolated world preserves all output formats
   // without changing page zoom, layout, input coordinates or the visible DOM.
   const pixels=await screenshot({...options,path:undefined,type:'png',quality:undefined,scale:'css',fullPage:true,clip:physicalClip});
   const payload=JSON.stringify({data:pixels.toString('base64'),width:clip.width,height:clip.height,mime:`image/${format}`,quality:(options.quality??80)/100});
   const encoded=await wc.executeJavaScriptInIsolatedWorld(1001,[{code:`(async()=>{
    const p=${payload};
    const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(p.data),c=>c.charCodeAt(0))],{type:'image/png'}));
    try{
     const canvas=new OffscreenCanvas(p.width,p.height);
     canvas.getContext('2d').drawImage(bitmap,0,0,p.width,p.height);
     const blob=await canvas.convertToBlob({type:p.mime,quality:p.quality});
     return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Screenshot encoding failed.'));reader.readAsDataURL(blob);});
    }finally{bitmap.close();}
   })()`}]);
   const data=Buffer.from(encoded.slice(encoded.indexOf(',')+1),'base64');
   if(options.path){await mkdir(path.dirname(options.path),{recursive:true});await writeFile(options.path,data);}
   return data;
  };
  page.setViewportSize=async size=>{
   if(!size||!Number.isInteger(size.width)||!Number.isInteger(size.height)||size.width<1||size.height<1)throw Error('Positive integer viewport dimensions are required.');
   const view=scope.views.get(wc.id);if(!view)throw Error('Embedded browser view is no longer available.');
   const previousViewport=view.kViewport,previousBounds=view.getBounds(),previousZoom=wc.getZoomFactor(),previousZoomMode=wc.getZoomMode();
   view.kViewport={...size};fitView(view,current===view?bounds:{x:0,y:0,...size});
   try{
    // Native view bounds and Chromium's renderer viewport settle asynchronously.
    // Wait for the renderer on background tabs too, then verify the observable
    // viewport instead of treating setBounds()/kViewport bookkeeping as success.
    await page.evaluate(()=>new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(Error('Embedded viewport rendering timed out.')),5000);
     requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));
    }));
    const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    if(Math.abs(actual.width-size.width)>1||Math.abs(actual.height-size.height)>1)
     throw Error(`Embedded viewport did not reach ${size.width}x${size.height} (actual ${actual.width}x${actual.height}).`);
   }catch(error){
    if(previousViewport)view.kViewport=previousViewport;else delete view.kViewport;
    view.setBounds(previousBounds);wc.setZoomMode(previousZoomMode);wc.setZoomFactor(previousZoom);
    throw error;
   }
  };
  page.once('close',()=>{scope.pages.delete(page);onPageClosed(page);});
  scope.events.emit('page',page);
  if(scope.popups.has(wc.id)){
   if(currentScope()===scope){if(await show(page,bounds,()=>currentScope()===scope))onPageActivated(page,'popup-open');}
   else onPageActivated(page,'popup-open');
  }
  return {scope,wc};
 }
 function classify(page){
  if(pageOwners.has(page))return Promise.resolve(pageOwners.get(page));
  if(classifying.has(page))return classifying.get(page);
  const pending=classifyPage(page).finally(()=>classifying.delete(page));
  classifying.set(page,pending);return pending;
 }
 const onPage=page=>{void classify(page).catch(error=>{for(const scope of scopes.values())scope.events.emit('scope-error',error);});};
 raw.on('page',onPage);
 async function launchContext(profile,{onDownload}={}){
  if(scopes.has(profile))throw Error('Embedded browser profile is already in use.');
  // New dedicated engine directory; never migrate or overwrite the old profile.
  const ses=session.fromPath(path.join(profile,'electron-browser'));
  const scope={session:ses,views:new Map(),popups:new Map(),pages:new Set(),events:new EventEmitter(),humanAllowed:false};
  scopes.set(profile,scope);
  const downloadHandler=onDownload?await prepareNativeDownloads({profileRoot:profile,stagingRoot:path.join(profile,'native-download-staging'),onDownload}):null;
  const willDownload=(event,item,wc)=>{if(!downloadHandler||!wc||!scope.views.has(wc.id)||scope.closing){event.preventDefault();return;}downloadHandler(event,item,wc);};
  ses.on('will-download',willDownload);
  ses.setPermissionCheckHandler(()=>false);
  ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  ses.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowed(details.url)}));
  const createPage=async()=>{
   const view=installView(scope,new WebContentsView({webPreferences:{...preferences,session:ses}}));
   const targetId=view.webContents.getOrCreateDevToolsTargetId();
   await view.webContents.loadURL('about:blank');
   const existing=raw.pages();
   for(const page of existing){await classify(page);const owner=pageOwners.get(page);if(owner?.wc.id===view.webContents.id)return page;}
   const attached=[...scope.pages].find(page=>pageOwners.get(page)?.wc.id===view.webContents.id);
   if(attached)return attached;
   return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{scope.events.off('page',handler);reject(Error(`Embedded page did not attach (${targetId}).`));},10000);
    const handler=page=>{if(pageOwners.get(page)?.wc.id!==view.webContents.id)return;clearTimeout(timer);scope.events.off('page',handler);resolve(page);};
    scope.events.on('page',handler);
   });
  };
  const closeScope=async()=>{
   scope.closing=true;
   ses.off('will-download',willDownload);
   for(const view of [...scope.views.values()]){
    if(window.contentView.children.includes(view))window.contentView.removeChildView(view);
    if(!view.webContents.isDestroyed())view.webContents.close();
   }
   await ses.flushStorageData();scopes.delete(profile);
  };
  const context=createElectronScopedContext({listPages:()=>[...scope.pages].filter(p=>!p.isClosed()),createPage,closeScope,events:scope.events,newCDPSession:page=>raw.newCDPSession(page)});
  scope.context=context;await context.newPage();return context;
 }
 async function show(page,rect=bounds,canCommit=()=>true){
  const ticket=++showGeneration;
  const owner=page?await classify(page):null;
  if(ticket!==showGeneration||!canCommit())return false;
  if(page&&!owner)throw Error('Cannot display a foreign page.');
  if(current&&window.contentView.children.includes(current))window.contentView.addChildView(current,0);
  current=owner?.scope.views.get(owner.wc.id)??null;
  bounds=rect;
  if(current){fitView(current,rect);window.contentView.addChildView(current);}
  syncInput();
  return true;
 }
 function setHumanInput(context,allowed,takeover){
  const scope=[...scopes.values()].find(scope=>scope.context===context);
  if(!scope)throw Error('Unknown embedded browser context.');
  scope.humanAllowed=allowed===true;scope.takeover=takeover;syncInput();
 }
 return {launchContext,show,setHumanInput,async close(){raw.off('page',onPage);for(const scope of [...scopes.values()])await scope.context.close();if(overlay&&!overlay.webContents.isDestroyed())overlay.webContents.close();}};
}
