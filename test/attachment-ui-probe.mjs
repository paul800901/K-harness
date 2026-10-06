// Built UI + real attachment storage, controller projection and queue; fake native host only.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
import {createDesktopController} from '../src/desktop-controller.mjs';
import {createInputQueue} from '../src/input-queue.mjs';
const output=path.resolve('.runtime/attachment-20261005/ui');await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5202,strictPort:true}}),results=[],errors=[];
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [width,height,scale,theme]of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark']]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const root=await mkdtemp(path.join(output,'fake-')),calls=[],model={model:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high'};
  let hooks,close,live=false,queue,c,itemId=0;
  const snapshot=()=>({...c.state,...queue.state,provider:'codex',conversationActivity:[]});
  const emit=async()=>{if(live)await page.evaluate(state=>window.testStream?.onmessage?.({data:JSON.stringify({type:'snapshot',state})}),snapshot());};
  const changed=()=>{queue?.schedule();void emit().catch(e=>errors.push(e.message));};
  const host={notify(){},waitForMcp:async()=>{},close:async()=>close(),request:async(method,p)=>{
   calls.push({method,p});
   if(method==='account/read')return {account:{type:'chatgpt'}};
   if(method==='model/list')return {data:[model]};
   if(method==='thread/start'||method==='thread/resume')return {thread:{id:'fake-attachment-ui'}};
   if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
   if(method==='turn/start'||method==='turn/steer'){
    if(method==='turn/start')hooks.onEvent({method:'turn/started',params:{threadId:'fake-attachment-ui',turn:{id:'turn-ui'}}});
    const item={type:'userMessage',id:`native-${++itemId}`,content:p.input};
    for(const event of ['item/started','item/completed'])hooks.onEvent({method:event,params:{threadId:'fake-attachment-ui',turnId:'turn-ui',item}});
    return method==='turn/start'?{turn:{id:'turn-ui'}}:{turnId:'turn-ui'};
   }
   if(method==='turn/interrupt')hooks.onEvent({method:'turn/completed',params:{threadId:'fake-attachment-ui',turn:{id:'turn-ui',status:'interrupted'}}});
   return {};
  }};
  c=createDesktopController({root,executable:'fixture',onChange:changed,hostFactory:options=>{hooks=options;host.closed=new Promise(r=>close=r);return host;}});
  await c.open({model:model.model});queue=createInputQueue({root,getController:()=>c,onChange:changed});await queue.load(c.state.threadId);
  await page.addInitScript(({state,scale,theme})=>{localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);window.EventSource=class{constructor(){window.testStream=this;setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state})}),0);}close(){}};},{state:snapshot(),scale,theme});
  await page.route('**/api/**',async route=>{
   const endpoint=new URL(route.request().url()).pathname;
   if(route.request().method()==='POST'){
    const request=route.request(),binary=endpoint==='/api/upload'&&request.headers()['content-type']==='application/octet-stream';
    const data=binary?{threadId:request.headers()['x-k-thread-id'],name:decodeURIComponent(request.headers()['x-k-file-name']),base64:request.postDataBuffer().toString('base64')}:request.postDataJSON();try{
     assert.equal(data.threadId,c.state.threadId);let result;
     if(endpoint==='/api/upload')result=await c.upload(data);
     else if(endpoint==='/api/send')result=c.state.busy?await queue.enqueue(data):await c.send(data);
     else if(endpoint==='/api/queue')result=await queue.action(data);
     else throw Error(`Unexpected write ${endpoint}`);
     await emit();await route.fulfill({json:result});
    }catch(e){await route.fulfill({status:400,json:{error:e.message}});}return;
   }
   const json=endpoint==='/api/state'?snapshot():endpoint==='/api/projects'?{projects:[{path:root,name:'附件測試'}]}:endpoint==='/api/sessions'?{sessions:[{threadId:c.state.threadId,title:'附件顯示與插隊測試',workspace:root,model:model.model,provider:'codex'}]}:endpoint==='/api/models'?{models:[model]}:{};
   await route.fulfill({json});
  });
  try{
   await page.goto('http://127.0.0.1:5202');live=true;await emit();
   const composer=page.getByRole('textbox',{name:'工作訊息',exact:true}),fileInput=page.locator('input[type=file]');
   await composer.fill('請整理這十二份假附件');
   await fileInput.setInputFiles(Array.from({length:12},(_,n)=>({name:`假資料-${n+1}.txt`,mimeType:'text/plain',buffer:n===0?Buffer.alloc(10*1024*1024,65):Buffer.from(`TEST ONLY ${n+1}`)})));
   await page.waitForFunction(()=>document.querySelectorAll('.composer-card .attachment-chip').length===12&&!/正在上傳|電腦正在保存/.test(document.querySelector('.composer-card .attachment-row')?.textContent??''));
   await page.getByRole('button',{name:'送出訊息',exact:true}).click();await page.locator('.user-bubble').first().waitFor();
   assert.equal(await page.locator('.user-bubble').first().innerText(),'請整理這十二份假附件');assert.equal(await page.locator('.user-message .attachment-chip').count(),12);assert.equal(c.state.messages.find(m=>m.role==='user').attachments[0].size,10*1024*1024);
   await page.waitForFunction(()=>document.querySelectorAll('.composer-card .attachment-chip').length===0);
   await composer.fill('補上第十三份附件');await fileInput.setInputFiles([{name:'補充.txt',mimeType:'text/plain',buffer:Buffer.from('FAKE EXTRA')}]);
   await page.getByRole('button',{name:'送出訊息（加入待送）',exact:true}).click();await page.locator('.queued-message').waitFor();
   const immediate=page.getByRole('button',{name:'立即送入',exact:true});assert(await immediate.isEnabled());await immediate.click();await page.locator('.queued-message').waitFor({state:'hidden'});
   assert.deepEqual(await page.locator('.user-bubble').allInnerTexts(),['請整理這十二份假附件','補上第十三份附件']);assert.equal(await page.locator('.user-message .attachment-chip').count(),13);
   const geometry=await page.locator('.user-bubble').first().evaluate(e=>{const r=e.getBoundingClientRect();return {height:r.height,width:r.width,viewport:innerWidth};});assert(geometry.height<140);assert(geometry.width<geometry.viewport);
   const input=calls.findLast(c=>c.method==='turn/steer').p.input;assert.match(input[0].text,/K_ATTACHMENT_CONTEXT/);assert.match(input[0].text,/補充.txt/);
   assert.equal(await page.getByText('每則訊息最多 8 份附件。',{exact:true}).count(),0);
   await page.screenshot({path:path.join(output,`${scale}-${theme}.png`)});results.push({width,height,scale,theme,attachments:13,userBubbles:2,geometry,passed:true});
  }finally{live=false;await queue.close();await c.close();await page.close();}
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:results.length,errors}));
}finally{await writeFile(path.join(output,'result.json'),JSON.stringify({results,errors},null,2));await browser?.close();await server.httpServer.close();}
