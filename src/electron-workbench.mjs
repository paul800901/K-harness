import {fileURLToPath} from 'node:url';
import {createElectronBrowserViews} from './electron-browser-views.mjs';
import {createBrowserOwnerGateway} from './browser-owner-gateway.mjs';

const originMatches=(value,expected)=>{
 if(typeof value!=='string'||!expected)return false;
 try{return new URL(value).origin===expected;}catch{return false;}
};

// The owner page needs microphone access for local dictation. Keep the
// partition deny-by-default and grant only an audio request from its own
// top-level application document or focused, same-origin sanitized clipboard
// writes. Clipboard reads, camera, display capture, and all other permissions
// remain denied.
export function createOwnerSessionMediaPermissionHandlers({ownerWebContents,getAppOrigin,isClosing}){
 const ownerFrameAllowed=(webContents,details)=>{
  try{
   if(isClosing()||webContents!==ownerWebContents||!webContents||webContents.isDestroyed())return false;
   if(details?.isMainFrame!==true)return false;
   const expected=getAppOrigin();
   if(!expected||!originMatches(expected,expected))return false;
   const mainFrame=webContents.mainFrame;
   return !!mainFrame&&originMatches(webContents.getURL(),expected)&&originMatches(mainFrame.url,expected);
  }catch{return false;}
 };
 const clipboardWriteAllowed=(webContents,details)=>{
  try{
   return ownerFrameAllowed(webContents,details)&&webContents.isFocused()===true&&
    originMatches(details.requestingUrl,getAppOrigin())&&
    details.embeddingOrigin===undefined;
  }catch{return false;}
 };
 const request=(webContents,permission,callback,details)=>{
  let allowed=false;
  try{
   if(permission==='media'){
    allowed=ownerFrameAllowed(webContents,details)&&Array.isArray(details.mediaTypes)&&details.mediaTypes.length===1&&details.mediaTypes[0]==='audio'&&
     originMatches(details.requestingUrl,getAppOrigin())&&(details.securityOrigin===undefined||originMatches(details.securityOrigin,getAppOrigin()));
   }else if(permission==='clipboard-sanitized-write')allowed=clipboardWriteAllowed(webContents,details);
  }catch{}
  callback(allowed);
 };
 const check=(webContents,permission,requestingOrigin,details)=>{
  try{
   if(permission==='media')return details?.mediaType==='audio'&&ownerFrameAllowed(webContents,details)&&
     originMatches(requestingOrigin,getAppOrigin())&&
     (details.securityOrigin===undefined||originMatches(details.securityOrigin,getAppOrigin()))&&
     (details.requestingUrl===undefined||originMatches(details.requestingUrl,getAppOrigin()))&&
     details.embeddingOrigin===undefined;
   if(permission==='clipboard-sanitized-write')return clipboardWriteAllowed(webContents,details)&&originMatches(requestingOrigin,getAppOrigin());
   return false;
  }catch{return false;}
 };
 const display=(_request,callback)=>callback(null);
 return {request,check,display};
}

// Trusted native shell. The factory determines candidate vs formal state; this
// module never chooses or copies a profile, provider credential, or workspace.
export async function createElectronWorkbench({electron,browser,servicesFactory,browserGatewayFactory}){
 const {BaseWindow,WebContentsView,ipcMain}=electron;
 const window=new BaseWindow({width:1440,height:960,title:'K 執行中樞',icon:fileURLToPath(new URL('../frontend/assets/k-logo.ico',import.meta.url))});window.setMenu(null);
 const owner=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'k-trusted-owner',preload:fileURLToPath(new URL('./electron-owner-preload.cjs',import.meta.url))}});
 owner.webContents.on('dom-ready',()=>owner.webContents.setBackgroundThrottling(false));
 window.contentView.addChildView(owner);
 let views,services,presented=null,requestedViewId=null,generation=0,closed=false,closing=false,closePromise=null;
 const pageIdentities=new WeakMap();
 const refreshNativePresentation=()=>{if(closed||closing||!window.isVisible()||window.isMinimized())return;owner.webContents.send('k-native-browser-page',{refresh:true});};
 // Closing the workbench view is not permission to terminate background work.
 // The trusted supervisor's explicit stop command owns service shutdown.
 window.on('close',event=>{if(!closed){event.preventDefault();if(!owner.webContents.isDestroyed())owner.webContents.send('k-native-window-hidden');window.hide();generation++;presented=null;requestedViewId=null;void views?.show(null);}});
 const resize=()=>{const [width,height]=window.getContentSize();owner.setBounds({x:0,y:0,width,height});if(views){generation++;presented=null;owner.webContents.focus();void views.show(null);}};
 window.on('resize',resize);window.on('restore',refreshNativePresentation);resize();
 const nativeGateway=async options=>{
  let context,gateway;
  gateway=await createBrowserOwnerGateway({...options,nativeDownloads:true,
   launchContext:async profile=>{context=await views.launchContext(profile,{onDownload:download=>gateway.acceptNativeDownload(download)});return context;},
   onControlChange:control=>{
    if(context)views.setHumanInput(context,control.humanInputAllowed,()=>gateway.humanRequest('/action',{type:'takeover'}));
   },
  });
  return gateway;
 };
 const senderAllowed=event=>{
  if(closed||closing||event.sender!==owner.webContents||event.senderFrame!==owner.webContents.mainFrame||new URL(event.senderFrame.url).origin!==services.app.origin)throw Error('Native browser owner required.');
 };
 const boundsFor=value=>{
  const [width,height]=window.getContentSize();
  if(!value||!['x','y','width','height'].every(key=>Number.isFinite(value[key])))throw Error('Invalid browser bounds.');
  const rect=Object.fromEntries(Object.entries(value).filter(([key])=>['x','y','width','height'].includes(key)).map(([key,n])=>[key,Math.round(n)]));
  if(rect.x<0||rect.y<0||rect.width<1||rect.height<1||rect.x+rect.width>width+1||rect.y+rect.height>height+1)throw Error('Browser bounds exceed owner window.');
  return rect;
 };
 try{
 services=await servicesFactory({gatewayFactory:browserGatewayFactory??nativeGateway});
  const ownerSession=electron.session.fromPartition('k-trusted-owner');
  const permissionHandlers=createOwnerSessionMediaPermissionHandlers({
   ownerWebContents:owner.webContents,
   getAppOrigin:()=>services?.app?.origin,
   isClosing:()=>closed||closing,
  });
  ownerSession.setPermissionRequestHandler(permissionHandlers.request);
  ownerSession.setPermissionCheckHandler(permissionHandlers.check);
  ownerSession.setDisplayMediaRequestHandler(permissionHandlers.display);
  views=createElectronBrowserViews({electron,window,browser,blockedOrigins:[services.app.origin],
   onPageClosed:page=>{const identity=pageIdentities.get(page);if(!closed&&!closing&&identity&&owner.webContents&&!owner.webContents.isDestroyed())owner.webContents.send('k-native-browser-page',{...identity,closed:true});},
   onPageActivated:async (page,reason='popup-open')=>{
    if(closed||closing)return;
    try{
     const state=services.app.controller.state,threadId=state.threadId;
     const data=await services.browsers.request(null,state,threadId,'/state');
     for(const info of data.pages??[]){
      const presentation=await services.browsers.presentation(state,threadId,info.id);
      if(presentation.page===page&&!page.isClosed()&&threadId===services.app.controller.state.threadId){pageIdentities.set(page,{threadId,pageId:info.id});owner.webContents.send('k-native-browser-page',{threadId,pageId:info.id,title:info.title,url:info.url,reason});break;}
     }
    }catch{/* A switched/closed conversation must not reactivate an old page. */}
   },
  });
  owner.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  owner.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==services.app.origin)event.preventDefault();});
  owner.webContents.on('will-redirect',(event,url)=>{if(new URL(url).origin!==services.app.origin)event.preventDefault();});
  ipcMain.handle('k-native-browser-present',async(event,request)=>{
   senderAllowed(event);
   if(browserGatewayFactory)return {shown:false,external:true};
   if(typeof request?.viewId!=='string'||request.viewId.length>100)throw Error('Native panel identity required.');
   const rect=boundsFor(request?.rect),ticket=++generation;requestedViewId=request.viewId;
   const state=services.app.controller.state;
   const presentation=await services.browsers.presentation(state,request.threadId,request.pageId);
   if(ticket!==generation||request.threadId!==services.app.controller.state.threadId)return {shown:false};
   if(!presentation.page){await views.show(null);return {shown:false};}
   pageIdentities.set(presentation.page,{threadId:request.threadId,pageId:request.pageId??presentation.control.selectedPageId});
   const shown=await views.show(presentation.page,rect,()=>ticket===generation&&!closed&&request.threadId===services.app.controller.state.threadId);
   if(shown)presented={threadId:request.threadId,viewId:request.viewId,page:presentation.page};
   return {shown};
  });
  ipcMain.handle('k-native-browser-hide',async(event,request)=>{
   senderAllowed(event);
   if(request?.viewId===requestedViewId){generation++;requestedViewId=null;presented=null;owner.webContents.focus();await views.show(null);}
   return {hidden:!presented};
  });
  await owner.webContents.loadURL(services.app.createLaunchUrl());
  window.show();
  return {window,owner,views,services,show(){if(closed||closing)throw Error('Workbench is closing.');window.show();window.focus();owner.webContents.send('k-native-browser-page',{refresh:true});},close(){
   if(closePromise)return closePromise;if(closed)return Promise.resolve();
   closing=true;generation++;
   closePromise=(async()=>{
    await views.show(null);
    // Services retain their own active-work policy at the caller boundary.
    await services.app.close();await views.close();closed=true;
    ipcMain.removeHandler('k-native-browser-present');ipcMain.removeHandler('k-native-browser-hide');
    if(!owner.webContents.isDestroyed())owner.webContents.close();if(!window.isDestroyed())window.destroy();
   })().catch(error=>{closePromise=null;throw error;});
   return closePromise;
  }};
 }catch(error){
  ipcMain.removeHandler('k-native-browser-present');ipcMain.removeHandler('k-native-browser-hide');
  await services?.app?.close().catch(()=>{});await views?.close().catch(()=>{});
  if(!owner.webContents.isDestroyed())owner.webContents.close();if(!window.isDestroyed())window.destroy();throw error;
 }
}
