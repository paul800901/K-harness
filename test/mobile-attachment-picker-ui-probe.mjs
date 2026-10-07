// Built React + real browser File/XHR + real attachment storage; synthetic SSE,
// authentication replies and controller. Not a real Android/provider acceptance.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import JSZip from 'jszip';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
import {createDesktopController} from '../src/desktop-controller.mjs';

const out=path.resolve('.runtime/mobile-attachment-picker');await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5218,strictPort:true}});
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=','base64');
const zip=new JSZip();zip.file('fixture.txt','SYNTHETIC ZIP CONTENT');
const docx=new JSZip();docx.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');docx.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>SYNTHETIC DOCX CONTENT</w:t></w:r></w:p></w:body></w:document>');
const formats=[['png',image],['jpg',await readFile(new URL('../frontend/assets/k-logo.jpg',import.meta.url))],['txt',Buffer.from('SYNTHETIC TEXT CONTENT')],['pdf',Buffer.from('%PDF-1.4\nSYNTHETIC invalid PDF extraction-failure fixture')],['docx',await docx.generateAsync({type:'nodebuffer'})],['zip',await zip.generateAsync({type:'nodebuffer'})],...['mp3','m4a','mp4','lrf'].map(ext=>[ext,Buffer.from('SYNTHETIC RAW MEDIA BYTES, NOT DECODE ACCEPTANCE')])].map(([ext,buffer])=>({name:'synthetic-phone.'+ext,mimeType:ext==='png'?'image/png':ext==='jpg'?'image/jpeg':'application/octet-stream',buffer}));
const results=[],errors=[];let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const scenario of ['picker-return','picker-cancel','switch-before-change','server-switch','network-error','expired-login','remove-pending','no-thread','connecting','offline','error','uncertain','stopping']){
  console.log('scenario: '+scenario);
  const root=await mkdtemp(path.join(out,'fixture-')),page=await browser.newPage({viewport:{width:360,height:740},isMobile:true,hasTouch:true});
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const hostFactory=()=>{let close;return {closed:new Promise(r=>{close=r;}),close:async()=>close(),notify(){},waitForMcp:async()=>{},request:async(method)=>{
   if(method==='account/read')return {account:{type:'chatgpt'}};
   if(method==='model/list')return {data:[{model:'gpt-6-luna',displayName:'GPT-6 Luna',inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'low'}],defaultReasoningEffort:'low'}]};
   if(method==='thread/start')return {thread:{id:'picker-a'}};
   if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
   return {};
  }}};
  const controller=createDesktopController({root,executable:'synthetic-host',hostFactory});
  await controller.open({model:'gpt-6-luna'});
  const state={...controller.state,title:'手機附件候選',provider:'codex',conversationActivity:[]},requests=[],savedFiles=[];let saved,held;
  const guarded=['connecting','offline','error','uncertain','stopping','no-thread'].includes(scenario);
  await page.addInitScript(state=>{
   window.pickerState=state;window.pausePickerSnapshot=false;
   window.EventSource=class{
    constructor(){window.pickerSource=this;if(!window.pausePickerSnapshot)setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:window.pickerState})}),0);}
    close(){}
   };
   window.pickerSnapshot=state=>{window.pickerState=state;window.pickerSource.onmessage?.({data:JSON.stringify({type:'snapshot',state})});};
   window.pickerVisibility=visibility=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:visibility});document.dispatchEvent(new Event('visibilitychange'));};
  },state);
  await page.route('http://127.0.0.1:5218/',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('<html','<html data-k-remote="true"')});});
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()==='POST'){
    assert.equal(url.pathname,'/api/upload','no work may be sent by the probe');
    const headers=request.headers(),bytes=request.postDataBuffer(),threadId=headers['x-k-thread-id'];
    assert.equal(headers['content-type'],'application/octet-stream');assert.equal(headers['x-k-request'],'1');assert(headers['x-k-command']);assert.deepEqual(bytes,formats.find(f=>f.name===decodeURIComponent(headers['x-k-file-name'])).buffer);
    requests.push({name:decodeURIComponent(headers['x-k-file-name']),threadId,command:headers['x-k-command'],bytes:bytes.length});
    if(scenario==='network-error')return route.abort('failed');
    if(scenario==='expired-login')return route.fulfill({status:403,json:{error:'合成手機登入已過期'}});
    if(scenario==='remove-pending'){held=route;return;}
    if(scenario==='server-switch')controller.state.threadId='picker-b';
    try{saved=await controller.uploadStream({threadId,name:decodeURIComponent(headers['x-k-file-name'])},Readable.from(bytes));savedFiles.push(saved);await route.fulfill({json:saved});}
    catch(error){await route.fulfill({status:409,json:{error:error.message}});}
    return;
   }
   await route.fulfill({json:url.pathname==='/api/models'?{models:[{model:state.model,provider:'codex',displayName:'GPT-6 Luna',inputModalities:['text','image']}]}:url.pathname==='/api/projects'?{projects:[{path:state.workspace,name:'假工作區'}]}:url.pathname==='/api/sessions'?{sessions:[]}:{} });
  });
  try{
   await page.goto('http://127.0.0.1:5218/');
   const composer=page.getByRole('textbox',{name:'工作訊息',exact:true}),fileInput=()=>page.locator('input[type=file]');
   await composer.fill('保留原草稿，不送出工作。');await page.getByRole('button',{name:'加入檔案',exact:true}).waitFor();
   // Keep the original browser chooser, even if switching rooms detaches its input.
   const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'加入檔案',exact:true}).click();const chooser=await chooserPromise;
   await page.evaluate(()=>{window.pausePickerSnapshot=true;window.pickerVisibility('hidden');window.pickerVisibility('visible');});
   await page.waitForFunction(()=>!document.querySelector('.remote-connection.connected'));
   assert.equal(await page.locator('.remote-connection.connected').count(),0,'snapshot must still be pending');
   if(scenario==='switch-before-change'){
    await page.evaluate(s=>window.pickerSnapshot({...s,threadId:'picker-b',title:'另一個假對話'}),state);
    assert.equal(await chooser.element().evaluate(el=>el.isConnected),false,'the original picker input must be detached');
    await chooser.setFiles({name:'synthetic-phone.png',mimeType:'image/png',buffer:image});
   }else if(guarded){
    const guardedState={...state,...(scenario==='no-thread'?{threadId:null}:{status:scenario})};
    await page.evaluate(s=>window.pickerSnapshot(s),guardedState);
    if(scenario==='no-thread'){assert.equal(await chooser.element().evaluate(el=>el.isConnected),false);await chooser.setFiles({name:'synthetic-phone.png',mimeType:'image/png',buffer:image});}
    else await chooser.setFiles({name:'synthetic-phone.png',mimeType:'image/png',buffer:image});
   }else if(scenario==='picker-cancel'){
    await chooser.setFiles([]);
   }else{
    await chooser.setFiles(scenario==='picker-return'?formats:{name:'synthetic-phone.png',mimeType:'image/png',buffer:image});
   }
   if(scenario==='picker-return'){
    await page.waitForFunction(count=>document.querySelectorAll('.composer-card .attachment-chip').length===count&&!/正在上傳|電腦正在保存/.test(document.querySelector('.composer-card .attachment-row').textContent),formats.length);
    assert.equal(requests.length,formats.length);assert(requests.every(r=>r.threadId===state.threadId));
    for(const record of savedFiles)assert.deepEqual((await controller.attachmentFile(record.id)).bytes,formats.find(f=>f.name===record.name).buffer);
    assert.equal(await composer.inputValue(),'保留原草稿，不送出工作。');
    await page.evaluate(s=>window.pickerSnapshot(s),state);
    assert.equal(await page.getByRole('alert').count(),0);
    await page.screenshot({path:path.join(out,'picker-return.png')});
   }else if(scenario==='remove-pending'){
    await page.getByRole('button',{name:'移除附件 synthetic-phone.png',exact:true}).click();
    await page.locator('.composer-card .attachment-chip').waitFor({state:'hidden'});assert.equal(requests.length,1);
    await held.abort().catch(()=>{});held=null;
   }else if(['picker-cancel','switch-before-change','no-thread'].includes(scenario)){
    await page.evaluate(s=>window.pickerSnapshot(s),state);
    await page.waitForFunction(()=>!!document.querySelector('.remote-connection.connected'));
    assert.equal(await page.getByRole('alert').count(),0,'detached chooser must not dispatch to the new room');
    assert.equal(requests.length,0);assert.equal(await page.locator('.composer-card .attachment-chip').count(),0);
   }else{
    const error=scenario==='server-switch'?'對話已切換':scenario==='network-error'?'附件上傳連線失敗':scenario==='expired-login'?'合成手機登入已過期':'請先連線並開啟對話後加入附件';
    await page.getByRole('alert').filter({hasText:error}).waitFor();
    assert.equal(requests.length,guarded?0:1);
    assert.equal(await page.locator('.composer-card .attachment-chip').count(),0);
    assert.equal(await composer.inputValue(),'保留原草稿，不送出工作。');
   }
   // Reconnect never replays an upload (or the user's draft).
   const requestCount=requests.length;
   if(!held){await page.evaluate(s=>window.pickerSnapshot(s),state);await page.waitForFunction(()=>!!document.querySelector('.remote-connection.connected'));}
   assert.equal(requests.length,requestCount,'reconnect must not retry an upload');
   results.push({scenario,requests:requests.length,threadIds:requests.map(x=>x.threadId),fileTypes:requests.map(x=>x.name.split('.').at(-1)),passed:true});
  }finally{if(held)await held.abort().catch(()=>{});await page.close();await controller.close();}
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({passed:results.length,results,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
