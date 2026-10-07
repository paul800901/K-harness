import {fileURLToPath} from 'node:url';
import {createTaskbarAttentionController,createWindowFocusNotifier} from './taskbar-attention.mjs';

export function createExternalLinkWindowHandler(openExternal){
 return ({url})=>{
  // Web links use the system browser, without a K-specific site allowlist.
  // Never turn a Markdown destination into an arbitrary OS protocol launch.
  try{if(['http:','https:'].includes(new URL(url).protocol))void openExternal(url).catch(()=>{});}catch{}
  return {action:'deny'};
 };
}

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
export async function createElectronWorkbench({electron,servicesFactory,browserGatewayFactory,relaunchExecutable}){
 const {BaseWindow,WebContentsView}=electron;
 const appName='K 執行中樞',appId='K.Harness.Desktop',icon=fileURLToPath(new URL('../frontend/assets/k-logo.ico',import.meta.url));
 electron.app.setName(appName);
 if(process.platform==='win32')electron.app.setAppUserModelId(appId);
 const window=new BaseWindow({width:1440,height:960,title:appName,icon});
 if(process.platform==='win32')window.setAppDetails({appId,appIconPath:icon,...(relaunchExecutable?{relaunchCommand:`"${relaunchExecutable}"`,relaunchDisplayName:appName}:{})});
 window.setMenu(null);
 const owner=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'k-trusted-owner',preload:fileURLToPath(new URL('./electron-owner-preload.cjs',import.meta.url))}});
 owner.webContents.on('dom-ready',()=>{owner.webContents.setBackgroundThrottling(false);focusNotifier?.notify();});
 owner.webContents.on('context-menu',(_event,{isEditable,selectionText,editFlags})=>{
  const items=isEditable
   ? [['undo','復原','canUndo'],['redo','重做','canRedo'],['cut','剪下','canCut'],['copy','複製','canCopy'],['paste','貼上','canPaste'],['selectAll','全選','canSelectAll']]
   : selectionText?[['copy','複製','canCopy']]:[];
  if(items.length)electron.Menu.buildFromTemplate(items.map(([action,label,flag])=>({label,enabled:editFlags[flag],click:()=>owner.webContents[action]()}))).popup({window});
 });
 window.contentView.addChildView(owner);
 let services,closed=false,closing=false,closePromise=null,taskbarAttention=null;
 const focusNotifier=createWindowFocusNotifier(window,owner.webContents);
 const refreshNativePresentation=()=>{if(closed||closing||!window.isVisible()||window.isMinimized())return;owner.webContents.send('k-native-browser-page',{refresh:true});};
 // Closing the workbench view is not permission to terminate background work.
 // The trusted supervisor's explicit stop command owns service shutdown.
 window.on('close',event=>{if(!closed){event.preventDefault();if(!owner.webContents.isDestroyed())owner.webContents.send('k-native-window-hidden');window.hide();}});
 const resize=()=>{const [width,height]=window.getContentSize();owner.setBounds({x:0,y:0,width,height});};
 window.on('resize',resize);window.on('restore',refreshNativePresentation);resize();
 try{
  services=await servicesFactory({gatewayFactory:browserGatewayFactory});
  taskbarAttention=createTaskbarAttentionController({window,electron,app:services.app});
  const ownerSession=electron.session.fromPartition('k-trusted-owner');
  const permissionHandlers=createOwnerSessionMediaPermissionHandlers({
   ownerWebContents:owner.webContents,
   getAppOrigin:()=>services?.app?.origin,
   isClosing:()=>closed||closing,
  });
  ownerSession.setPermissionRequestHandler(permissionHandlers.request);
  ownerSession.setPermissionCheckHandler(permissionHandlers.check);
  ownerSession.setDisplayMediaRequestHandler(permissionHandlers.display);
  owner.webContents.setWindowOpenHandler(createExternalLinkWindowHandler(url=>electron.shell.openExternal(url)));
  owner.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==services.app.origin)event.preventDefault();});
  owner.webContents.on('will-redirect',(event,url)=>{if(new URL(url).origin!==services.app.origin)event.preventDefault();});
  await owner.webContents.loadURL(services.app.createLaunchUrl());
  window.show();
  return {window,owner,services,show(){if(closed||closing)throw Error('Workbench is closing.');window.show();window.focus();owner.webContents.send('k-native-browser-page',{refresh:true});},close(){
   if(closePromise)return closePromise;if(closed)return Promise.resolve();
   closing=true;
   closePromise=(async()=>{
    // Services retain their own active-work policy at the caller boundary.
    await services.app.close();closed=true;
    taskbarAttention?.dispose();focusNotifier.dispose();
    if(!owner.webContents.isDestroyed())owner.webContents.close();if(!window.isDestroyed())window.destroy();
   })().catch(error=>{closing=false;closePromise=null;throw error;});
   return closePromise;
  }};
 }catch(error){
  taskbarAttention?.dispose();focusNotifier.dispose();
  await services?.app?.close().catch(()=>{});
  if(!owner.webContents.isDestroyed())owner.webContents.close();if(!window.isDestroyed())window.destroy();throw error;
 }
}
