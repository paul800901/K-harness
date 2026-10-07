// Real Electron + built chat UI, synthetic services and intercepted OS opener.
// No provider calls, real OAuth URLs, browser profiles, or foreground windows.
const electron=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdir,mkdtemp,writeFile}=require('node:fs/promises');
const repo=path.resolve(__dirname,'..');
const out=path.resolve(process.env.K_CHAT_LINK_OUTPUT||'.runtime/chat-links-electron-probe');
const receipt={passed:false,scope:'real Electron / built UI / fake services / intercepted shell.openExternal',checks:[]};
let wb;
const wait=async check=>{const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Chat link probe timed out');};
(async()=>{
 await mkdir(out,{recursive:true});
 const root=await mkdtemp(path.join(out,'fixture-'));
 electron.app.setPath('userData',path.join(root,'shell'));
 await electron.app.whenReady();
 const {createElectronWorkbench}=await import(pathToFileURL(process.env.K_CHAT_LINK_MODULE||path.join(repo,'src/electron-workbench.mjs')).href);
 const {startDesktop}=await import(pathToFileURL(path.join(repo,'src/desktop-server.mjs')).href);
 const urls=['https://example.test/research?q=a%2Bb#section','http://127.0.0.1:5137/callback?state=fixture','https://example.com/?q=fixture%2B1#public','https://developer.mozilla.org/en-US/docs/Web/API/URL?q=fixture#examples','https://github.com/openai/codex?q=fixture#readme'];
 const state={threadId:'fake-links',workspace:root,title:'連結驗證',status:'ready',busy:false,provider:'codex',model:'gpt-6.1-sol',accessMode:'workspace-write',capabilities:{},messages:[{id:'link-response',role:'assistant',text:urls.map((url,i)=>`[測試連結 ${i}](${url})`).join('\n\n')}],tools:[],workers:[],questions:[],artifacts:[],notices:[],usage:{}};
 const opened=[],popups=[],menus=[],clipboardWrites=[];
 const menu={buildFromTemplate(template){menus.push(template);return {popup(){}};}};
 // Hidden test workbench cannot steal the user's foreground or keyboard.
 class HiddenWindow extends electron.BaseWindow{constructor(options){super({...options,show:false});}show(){}}
 const fakeLogin=()=>({async close(){},async status(){return {available:false};},progress(){return {status:'idle'};}});
 wb=await createElectronWorkbench({electron:{...electron,BaseWindow:HiddenWindow,Menu:menu,clipboard:{writeText:text=>clipboardWrites.push(text)},shell:{openExternal:async url=>{opened.push(url);}}},servicesFactory:async()=>({app:await startDesktop({root,port:0,controllerFactory:()=>({state,async sessions(){return {sessions:[]};},async models(){return {models:[]};},async usage(){return {};},async close(){}}),claudeLoginFactory:fakeLogin,codexLoginFactory:fakeLogin,geminiLoginFactory:fakeLogin,localDictationFactory:()=>({async close(){}})})})});
 const wc=wb.owner.webContents,origin=wb.services.app.origin;
 wc.on('did-create-window',()=>popups.push(true));
 await wait(()=>wc.executeJavaScript('document.querySelectorAll(".markdown a").length===5'));
 const anchors=await wc.executeJavaScript('[...document.querySelectorAll(".markdown a")].map(a=>({href:a.href,target:a.target}))');
 assert.deepEqual(anchors,urls.map(href=>({href,target:'_blank'})));
 wc.debugger.attach('1.3');
 for(let i=0;i<urls.length;i++){
  const rect=await wc.executeJavaScript(`(()=>{const a=document.querySelectorAll('.markdown a')[${i}],r=a.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});
  await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});
  await wait(()=>opened.length===i+1);
  assert.equal(opened[i],urls[i],'complete URL must reach the OS opener unchanged');
  assert.equal(new URL(wc.getURL()).origin,origin,'the chat must not navigate away');
  receipt.checks.push({url:urls[i],clicked:true,openerReceivedExactUrl:true,chatPreserved:true});
 }
 const linkRect=await wc.executeJavaScript("(()=>{const a=document.querySelector('.markdown a'),r=a.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
 await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',clickCount:1,...linkRect});
 await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',clickCount:1,...linkRect});
 await wait(()=>menus.length===1);
 const copyLink=menus[0].find(item=>item.label==='複製連結網址');
 assert.ok(copyLink,'HTTP/S links expose a copy-link context item');copyLink.click();
 assert.deepEqual(clipboardWrites,[urls[0]],'copy-link writes the exact complete link URL');
 receipt.copyLinkExactUrl=true;receipt.selectionCopyPreserved=true;
 const beforeUnsafeMenuCount=menus.length;
 wc.emit('context-menu',{preventDefault(){}},{isEditable:false,selectionText:'',editFlags:{},linkURL:'file:///C:/Windows/System32/cmd.exe'});
 wc.emit('context-menu',{preventDefault(){}},{isEditable:false,selectionText:'selected fixture text',editFlags:{canCopy:true},linkURL:'custom-protocol:fixture'});
 assert.equal(menus.length,beforeUnsafeMenuCount+1,'unsafe schemes do not add a link-copy item, while selected-text menu remains');
 assert.deepEqual(menus.at(-1).map(item=>item.label),['複製']);
 assert.deepEqual(clipboardWrites,[urls[0]]);
 receipt.nonWebSchemesRejected=true;
 await wc.executeJavaScript("window.open('file:///C:/Windows/System32/cmd.exe','_blank');window.open('ms-settings:','_blank')");
 assert.equal(opened.length,urls.length);assert.deepEqual(popups,[]);
 await writeFile(path.join(out,'chat-links.png'),(await wc.capturePage()).toPNG());
 receipt.passed=true;receipt.noElectronPopups=true;receipt.noOSProtocolLaunch=true;receipt.hidden=!wb.window.isVisible();
})().catch(error=>{receipt.error=error.stack;process.exitCode=1;}).finally(async()=>{
 await writeFile(path.join(out,'result.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt));
 await wb?.close();electron.app.exit(receipt.passed?0:1);
});
