// Fake-data-only integration pilot. Never loaded by the production launcher.
const {app,BaseWindow,WebContentsView,session}=require('electron');
const {createServer}=require('node:http');
const {mkdirSync,writeFileSync,appendFileSync}=require('node:fs');
const path=require('node:path');
const {createInterface}=require('node:readline');
const root=process.env.K_ELECTRON_PILOT_ROOT;
if(!root||!path.isAbsolute(root))throw Error('An explicit pilot output directory is required.');
mkdirSync(root,{recursive:true});
app.setPath('userData',path.join(root,'electron-home'));
// Already protected by the existing K sandbox policy; no new network rule.
app.commandLine.appendSwitch('remote-debugging-address','127.0.0.1');
app.commandLine.appendSwitch('remote-debugging-port','47971');
let win,server,page,chrome;
const emit=value=>{appendFileSync(path.join(root,'pilot-events.jsonl'),JSON.stringify(value)+'\n');if(process.send)process.send(value);else process.stdout.write(JSON.stringify(value)+'\n');};
app.on('child-process-gone',(_event,details)=>emit({type:'diagnostic',child:details}));
app.on('render-process-gone',(_event,_contents,details)=>emit({type:'diagnostic',renderer:details}));
app.whenReady().then(async()=>{
 server=createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.url==='/popup'){res.end('<title>假登入視窗</title><button onclick="document.cookie=\'fake_login=ok; path=/; SameSite=Lax\';window.close()">完成假登入</button>');return;}
  if(req.url==='/owner'){res.end('<title>可信介面假頁</title><h1>OWNER ONLY</h1>');return;}
  res.end('<!doctype html><meta charset="utf-8"><title>K 真瀏覽器假資料驗證</title><h1>可直接操作的網頁</h1><label>測試文字 <input id="text"></label><button id="popup" onclick="window.open(\'/popup\',\'login\',\'width=500,height=400\')">假登入</button><p id="status"></p><button onclick="document.querySelector(\'#status\').textContent=document.cookie">讀回假登入</button><div style="height:1600px;background:linear-gradient(#fff,#dcd2c0)">捲動測試</div><p>頁面底部</p>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 emit({type:'diagnostic',origin});
 win=new BaseWindow({width:1200,height:850,title:'K 真瀏覽器候選驗證（僅假資料）'});
 win.setMenu(null);
 const prefs={sandbox:true,contextIsolation:true,nodeIntegration:false};
 chrome=new WebContentsView({webPreferences:{...prefs,partition:'pilot-owner'}});
 page=new WebContentsView({webPreferences:{...prefs,session:session.fromPath(path.join(root,'fake-browser-profile'))}});
 win.contentView.addChildView(chrome);win.contentView.addChildView(page);
 const layout=()=>{const [w,h]=win.getContentSize();chrome.setBounds({x:0,y:0,width:360,height:h});page.setBounds({x:360,y:0,width:w-360,height:h});};
 layout();win.on('resize',layout);
 page.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 page.webContents.session.setPermissionCheckHandler(()=>false);
 page.webContents.setWindowOpenHandler(({url})=>new URL(url).origin===origin?{action:'allow',overrideBrowserWindowOptions:{webPreferences:{...prefs,session:page.webContents.session}}}:{action:'deny'});
 emit({type:'started',origin});
 await chrome.webContents.loadURL(origin+'/owner');
 await page.webContents.loadURL(origin+'/');
 emit({type:'ready',origin,pageId:page.webContents.id,ownerId:chrome.webContents.id});
}).catch(error=>emit({type:'error',message:error.stack}));
let closePromise;
const close=()=>closePromise??=(async()=>{for(const view of win?.contentView.children??[])view.webContents?.close();win?.close();if(server)await new Promise(resolve=>server.close(resolve));emit({type:'closed'});app.quit();})();
const commandReceived=async command=>{
 try{
  if(command.type==='capture'){
   const image=await page.webContents.capturePage();const file=path.join(root,'native-page.png');writeFileSync(file,image.toPNG());emit({type:'capture',file});
  }else if(command.type==='close')await close();
 }catch(error){emit({type:'error',message:error.message});}
};
process.on('message',commandReceived);
process.on('disconnect',()=>void close());
app.on('window-all-closed',()=>{});
