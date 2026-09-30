// Isolated test shell: production preload/server, fake conversations and audio only.
const {app,BrowserWindow}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..');
app.setPath('userData',path.join(process.env.K_VOICE_TEST_ROOT,'electron'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture',process.env.K_VOICE_TEST_WAV);
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const {startDesktop}=await import(pathToFileURL(path.join(root,'src/desktop-server.mjs')));
 const {createLocalDictation}=await import(pathToFileURL(path.join(root,'src/local-dictation.mjs')));
 const {createOwnerSessionMediaPermissionHandlers}=await import(pathToFileURL(path.join(root,'src/electron-workbench.mjs')));
 const state={threadId:'voice-test',title:'語音接線驗證',workspace:process.env.K_VOICE_TEST_ROOT,provider:'codex',model:'gpt-6.1-sol',status:'ready',busy:false,messages:[],tools:[],questions:[],notices:[],artifacts:[],accessMode:'workspace-write',capabilities:{},conversationActivity:[]};
 const engine=createLocalDictation();
 const fixture=global.fixture={calls:[],sends:[],fail:false};
 const controller={state,async sessions(){return {sessions:[]};},async models(){return [];},async usage(){return {};},async close(){},async send(data){fixture.sends.push(data);return {sent:true};}};
 const login=()=>({async status(){return {available:false};},async close(){}});
 const server=await startDesktop({root:process.env.K_VOICE_TEST_ROOT,port:0,controllerFactory:()=>controller,claudeLoginFactory:login,codexLoginFactory:login,
  localDictationFactory:()=>({async transcribe(audio,options){fixture.calls.push({bytes:Buffer.from(audio,'base64').length});if(fixture.fail)throw Error('測試辨識失敗');return engine.transcribe(audio,options);},close:()=>engine.close()})});
 const window=fixture.window=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:path.join(root,'src/electron-owner-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 const handlers=createOwnerSessionMediaPermissionHandlers({ownerWebContents:window.webContents,getAppOrigin:()=>server.origin,isClosing:()=>false});
 window.webContents.session.setPermissionRequestHandler(handlers.request);
 window.webContents.session.setPermissionCheckHandler(handlers.check);
 window.webContents.session.setDisplayMediaRequestHandler(handlers.display);
 fixture.close=async()=>{await server.close();window.destroy();};
 await window.loadURL(server.createLaunchUrl());
}).catch(error=>{console.error(error);app.exit(1);});
