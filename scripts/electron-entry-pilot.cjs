// Fake services for the real native entry/launcher protocol, not a formal mode.
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdir,writeFile}=require('node:fs/promises');
const {startNativeOwner}=require('../src/electron-isolated-main.cjs');
const electron=require('electron');
const runtime=path.resolve(__dirname,'..');
const candidate=path.resolve(runtime,'..','..');
const run=path.join(candidate,'vault',`native-entry-probe-${Date.now()}`);
const moduleAt=file=>import(pathToFileURL(path.join(runtime,'src',file)).href);
const state={status:'working',busy:true,threadId:'fake-entry',provider:'codex',model:'gpt-6-luna',modelDisplayName:'假資料驗證',title:'原生啟動器驗證',workspace:run,
 browserAccess:{enabled:false},messages:[],tools:[],workers:[],artifacts:[],questions:[],notices:[],reasoning:[],modelChanges:[],
 accessMode:'workspace-write',usage:{},progress:{plan:[]},capabilities:{}};
process.on('message',message=>{if(message?.type==='test-idle'){state.status='ready';state.busy=false;process.send({type:'test-idle-ready'});}});
(async()=>{
 await mkdir(run,{recursive:true});
 const {startDesktop}=await moduleAt('desktop-server.mjs');
 const {createOwnerBrowserRegistry}=await moduleAt('owner-browser-registry.mjs');
 const wb=await startNativeOwner({paths:{vault:path.join(candidate,'vault')},userDataPath:path.join(run,'shell'),servicesFactory:async({gatewayFactory})=>{
  const browsers=createOwnerBrowserRegistry({vault:path.join(run,'profiles'),outputRoot:path.join(run,'outputs'),gatewayFactory});
  const controller={state,async sessions(){return {sessions:[]};},async usage(){return state.usage;},async close(){}};
  const login=()=>({async close(){}});
  const app=await startDesktop({root:run,executable:'fake',port:47831,requireLaunchToken:true,controllerFactory:()=>controller,browserRequest:browsers.request,
   claudeLoginFactory:login,codexLoginFactory:login});
  return {browsers,app:{...app,async close(){await app.close();await browsers.close();}}};
 }});
 const wait=async()=>{for(let n=0;n<100;n++){if(await wb.owner.webContents.executeJavaScript('document.body.innerText.includes("原生啟動器驗證")'))return;await new Promise(r=>setTimeout(r,50));}throw Error('Native owner UI not rendered.');};
 await wait();
 await writeFile(path.join(run,'owner-ui.png'),(await wb.owner.webContents.capturePage()).toPNG());
 process.send({type:'test-ui-ready',visible:wb.window.isVisible(),run});
})().catch(error=>{process.send?.({type:'test-failed',error:error.stack});electron.app.exit(1);});
