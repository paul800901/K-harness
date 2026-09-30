const electron=require('electron');
const {app,BaseWindow,Menu,clipboard}=electron;
const {createServer}=require('node:http');
const {once}=require('node:events');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdtempSync}=require('node:fs');
app.setPath('userData',mkdtempSync(path.join(require('node:os').tmpdir(),'k-context-menu-')));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 let workbench,server;
 const saved=await Promise.all((await clipboard.read()).map(async item=>new electron.ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
 try{
  server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<textarea style="width:400px;height:100px">保留草稿</textarea><p>回應測試文字</p>');});server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const {createElectronWorkbench}=await import(pathToFileURL(path.resolve(__dirname,'../../src/electron-workbench.mjs')));
  let menu;
  class HiddenWindow extends BaseWindow{constructor(opts){super({...opts,show:false});}show(){super.show();this.focus();}}
  workbench=await createElectronWorkbench({electron:{...electron,BaseWindow:HiddenWindow,Menu:{buildFromTemplate(template){menu=Menu.buildFromTemplate(template);return {popup(){}};}}},servicesFactory:async()=>({app:{origin,createLaunchUrl:()=>origin,close:async()=>{}}})});
  const wc=workbench.owner.webContents;await new Promise(r=>setTimeout(r,300));wc.focus();
  const run=code=>wc.executeJavaScript(code);
  const context=async(x,y)=>{menu=null;const ready=Promise.race([once(wc,'context-menu'),new Promise((_,reject)=>setTimeout(()=>reject(Error('context menu event timeout')),3000))]);wc.sendInputEvent({type:'mouseMove',x,y});wc.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,x,y});wc.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,x,y});await ready;assert(menu,'right-click must build a native menu');};
  await run("document.querySelector('textarea').focus();document.querySelector('textarea').select()");
  await context(30,30);assert.deepEqual(menu.items.map(i=>i.label),['復原','重做','剪下','複製','貼上','全選']);
  menu.items.find(i=>i.label==='複製').click();await new Promise(r=>setTimeout(r,80));assert.equal(await clipboard.readText(),'保留草稿');
  await clipboard.writeText('貼上測試');await run("document.querySelector('textarea').setSelectionRange(4,4)");
  await context(300,30);menu.items.find(i=>i.label==='貼上').click();await new Promise(r=>setTimeout(r,80));assert.equal(await run("document.querySelector('textarea').value"),'保留草稿貼上測試');
  await run("document.querySelector('textarea').select()");await context(30,30);menu.items.find(i=>i.label==='剪下').click();await new Promise(r=>setTimeout(r,80));assert.equal(await run("document.querySelector('textarea').value"),'');
  await context(30,30);menu.items.find(i=>i.label==='復原').click();await new Promise(r=>setTimeout(r,80));assert.equal(await run("document.querySelector('textarea').value"),'保留草稿貼上測試');
  await run("document.querySelector('textarea').blur();const r=document.createRange();r.selectNodeContents(document.querySelector('p'));getSelection().removeAllRanges();getSelection().addRange(r)");
  await context(30,130);assert.deepEqual(menu.items.map(i=>i.label),['複製']);menu.items[0].click();await new Promise(r=>setTimeout(r,80));assert.equal(await clipboard.readText(),'回應測試文字');
  console.log('PASS: real Electron context-menu event, native Menu, copy/paste/cut/undo and selected response copy; no provider calls');
 }finally{if(saved.length)await clipboard.write(saved);else clipboard.clear();await workbench?.close();server?.close();}
 app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});

