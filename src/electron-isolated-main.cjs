const path=require('node:path');
const {createRequire}=require('node:module');
const {mkdir,realpath,stat}=require('node:fs/promises');

const root=path.resolve(__dirname,'..');
const requireFromRuntime=createRequire(path.join(root,'package.json'));
let ownerWorkbench=null,shuttingDown=false,ownerClosed=false,ownerClosePromise=null,electronApp=requireFromRuntime('electron').app,ownerServices=null;

function reply(id,ok,value){if(process.connected)process.send({type:'owner-response',id,ok,...(ok?{value}:{})});}
async function closeOwner(){
 if(ownerClosed)return;
 if(ownerClosePromise)return ownerClosePromise;
 ownerClosePromise=(async()=>{
  if(ownerWorkbench)await ownerWorkbench.close();
  else await ownerServices?.app?.close();
  ownerClosed=true;
 })();
 try{await ownerClosePromise;}catch(error){ownerClosePromise=null;throw error;}
}
async function shutdown(){
 if(shuttingDown)return;shuttingDown=true;
 try{await closeOwner();}catch{process.exitCode=1;if(process.connected)process.send({type:'owner-error'});}
 try{electronApp?.quit();}catch{}
}

function handleParentMessage(message){
 if(message?.type==='owner-request'&&Number.isSafeInteger(message.id))void handleOwnerRequest(message);
}
process.on('message',handleParentMessage);

async function startNativeOwner({servicesFactory,electron=requireFromRuntime('electron'),paths,userDataPath}={}){
 electronApp=electron.app;
 if(shuttingDown||!process.connected){electronApp.quit();throw Error('Native supervisor disconnected before Electron startup.');}
 const {isolatedLauncherPaths,startIsolatedOwner}=await import(pathToFileUrl(path.join(__dirname,'isolated-launcher.mjs')));
 paths??=isolatedLauncherPaths();
 await stat(paths.vault).then(value=>{if(!value.isDirectory())throw Error('Candidate vault is unavailable.');});
 const nativeUserData=path.resolve(userDataPath??path.join(paths.vault,'native-shell'));
 const requestedRelative=path.relative(path.resolve(paths.vault),nativeUserData);
 if(!requestedRelative||requestedRelative==='..'||requestedRelative.startsWith(`..${path.sep}`)||path.isAbsolute(requestedRelative))
  throw Error('Electron user-data directory must remain inside the candidate vault.');
 await mkdir(nativeUserData,{recursive:true});
 const actual=await realpath(nativeUserData),vault=await realpath(paths.vault),relative=path.relative(vault,actual);
 if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw Error('Electron user-data directory escaped the private candidate vault.');
 electron.app.setPath('userData',actual);
 await electron.app.whenReady();
 if(shuttingDown||!process.connected)throw Error('Native supervisor disconnected during startup.');
 const {createElectronWorkbench}=await import(pathToFileUrl(path.join(__dirname,'electron-workbench.mjs')));
 const factory=servicesFactory??(async({gatewayFactory})=>{
  ownerServices=await startIsolatedOwner({paths,nodeExecutable:process.env.K_ISOLATED_PARENT_NODE_EXECUTABLE,gatewayFactory});
  if(shuttingDown||!process.connected){await ownerServices.app.close();throw Error('Native supervisor disconnected during startup.');}
  return ownerServices;
 });
 const {loadKBrowserAssistant}=await import(pathToFileUrl(path.join(__dirname,'k-browser-assistant.mjs')));
 const browserGatewayFactory=await loadKBrowserAssistant({vault:paths.vault});
 const relaunchExecutable=path.resolve(paths.root,'../../..','local-launcher/dist/K桌面啟動器.exe');
 ownerWorkbench=await createElectronWorkbench({electron,servicesFactory:factory,browserGatewayFactory,relaunchExecutable});
 ownerWorkbench.services.app.onClosed?.(()=>{if(!shuttingDown&&process.connected)process.send({type:'owner-close-request'});});
 if(shuttingDown||!process.connected){await ownerWorkbench.close();throw Error('Native supervisor disconnected during startup.');}
 ownerWorkbench.show();
 if(process.connected)process.send({type:'owner-ready',origin:'http://127.0.0.1:47831'});
 electron.app.on('before-quit',event=>{
  if(shuttingDown)return;
  event.preventDefault();
  void shutdown();
 });
 return ownerWorkbench;
}
function pathToFileUrl(value){return require('node:url').pathToFileURL(value).href;}
async function handleOwnerRequest({id,method}){
 try{
  if(method==='show'){ownerWorkbench.show();return reply(id,true,{shown:true});}
  if(method==='close'){shuttingDown=true;try{await closeOwner();reply(id,true,{closed:true});setImmediate(()=>{try{electronApp?.quit();}catch{}});}catch{shuttingDown=false;reply(id,false);}return;}
  reply(id,false);
 }catch{reply(id,false);}
}

process.once('disconnect',()=>void shutdown());
process.once('SIGTERM',()=>void shutdown());
process.once('SIGINT',()=>void shutdown());
// Electron's default loader owns require.main even when this file is the entry.
// Imported candidate fixtures still start explicitly with their own services.
const entryPath=process.argv[1]&&path.resolve(process.argv[1]),mainPath=path.resolve(__filename);
const isDirectEntry=entryPath&&(process.platform==='win32'
 ?entryPath.toLowerCase()===mainPath.toLowerCase()
 :entryPath===mainPath);
if(isDirectEntry)startNativeOwner().catch(async()=>{
 if(process.connected)process.send({type:'owner-error'});
 await shutdown();
 process.exitCode=1;
});

module.exports={startNativeOwner};

