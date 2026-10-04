// Built UI + real K input queue, fake controllers only. No provider or production requests.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {preview} from 'vite';
import {createInputQueue} from '../src/input-queue.mjs';
const output=path.resolve('.runtime/queue-edit-20261005');await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5201,strictPort:true}}),results=[],errors=[];
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [width,height,scale,theme]of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark']]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  const workspace=await mkdtemp(path.join(output,'fake-')),calls=[],requests=[];
  const A={threadId:'fake-A',title:'測試對話 A',workspace,busy:true,status:'working',model:'gpt-6.1-sol',provider:'codex',messages:[],tools:[],questions:[],artifacts:[],workers:[],accessMode:'workspace-write',capabilities:{steer:true}},B={...A,threadId:'fake-B',title:'測試對話 B',busy:false,status:'ready'};
  let selected=A,live=false;
  const controller={state:A,send:async data=>{calls.push({method:'send',...data});A.busy=true;A.status='working';return {sent:true};},steer:async data=>{calls.push({method:'steer',...data});if(data.text==='uncertain')throw Error('test delivery unknown');return {steered:true};}};
  const snapshot=()=>({...selected,...(selected===A?queue.state:{queuedMessages:[]}),conversationActivity:[{threadId:A.threadId,busy:A.busy,status:A.status},{threadId:B.threadId,busy:B.busy,status:B.status}]});
  const emit=async()=>{if(live)await page.evaluate(state=>window.testStream?.onmessage?.({data:JSON.stringify({type:'snapshot',state})}),snapshot());};
  const queue=createInputQueue({root:workspace,getController:()=>controller,onChange:()=>{void emit().catch(e=>errors.push(e.message));}});await queue.load(A.threadId);
  await queue.enqueue({text:'第一則原文'});const attachment=await queue.enqueue({text:'有附件原文',attachmentIds:['fake-file']});
  await page.addInitScript(({state,scale,theme})=>{localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);window.EventSource=class{constructor(){window.testStream=this;setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state})}),0);}close(){}};},{state:snapshot(),scale,theme});
  await page.route('**/api/**',async route=>{
   const endpoint=new URL(route.request().url()).pathname;
   if(route.request().method()==='POST'){
    const data=route.request().postDataJSON();requests.push({endpoint,data});
    try{
     let result;if(endpoint==='/api/queue'){assert.equal(data.threadId,A.threadId);result=await queue.action(data);}
     else if(endpoint==='/api/open'){assert([A.threadId,B.threadId].includes(data.threadId));selected=data.threadId===A.threadId?A:B;result={opened:true};}
     else throw Error(`Unexpected write ${endpoint}`);
     await emit();await route.fulfill({json:result});
    }catch(error){await route.fulfill({status:400,json:{error:error.message}});}
    return;
   }
   const json=endpoint==='/api/state'?snapshot():endpoint==='/api/projects'?{projects:[{path:workspace,name:'測試工作區'}]}:endpoint==='/api/sessions'?{sessions:[A,B].map(s=>({threadId:s.threadId,title:s.title,workspace,model:s.model,provider:'codex'}))}:endpoint==='/api/models'?{models:[{model:A.model,displayName:'GPT-6.1 Sol',provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]}:{};
   await route.fulfill({json});
  });
  try{
   await page.goto('http://127.0.0.1:5201');live=true;
   const composer=page.getByRole('textbox',{name:'工作訊息',exact:true});await composer.fill('保留主輸入框草稿');
   const row=()=>page.locator('.queued-message').first(),editor=()=>page.getByRole('textbox',{name:'編輯待送訊息',exact:true});
   await row().getByRole('button',{name:'編輯',exact:true}).click();await editor().fill('尚未儲存的修改');
   await page.locator('.session-open').filter({hasText:B.title}).click();await editor().waitFor({state:'hidden'});assert.equal(await composer.inputValue(),'');
   await page.locator('.session-open').filter({hasText:A.title}).click();await editor().waitFor();assert.equal(await editor().inputValue(),'尚未儲存的修改');assert.equal(await composer.inputValue(),'保留主輸入框草稿');
   A.busy=false;A.status='completed';queue.schedule();await emit();await delay(180);assert.deepEqual(calls,[],'Editing must hold the first message even after work completes');
   const geometry=await editor().evaluate(e=>{const r=e.getBoundingClientRect(),p=e.closest('.queued-messages').getBoundingClientRect();return {inside:r.left>=p.left&&r.right<=p.right,overflow:e.closest('.queued-messages').scrollWidth>e.closest('.queued-messages').clientWidth};});assert(geometry.inside&&!geometry.overflow);
   const composerButton=await page.locator('.composer-send-actions .send-button').boundingBox();assert(composerButton.y>=0&&composerButton.y+composerButton.height<=height,'Queue editor must leave the composer controls in the viewport');
   await page.screenshot({path:path.join(output,`${scale}-${theme}-editing.png`)});
   await row().getByRole('button',{name:'儲存',exact:true}).click();await editor().waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('.queued-message>span')?.textContent.includes('有附件原文'));
   assert.deepEqual(calls,[{method:'send',text:'尚未儲存的修改',attachmentIds:[]}]);assert.equal(await composer.inputValue(),'保留主輸入框草稿');
   await row().getByRole('button',{name:'編輯',exact:true}).click();await editor().fill('這次取消');await row().getByRole('button',{name:'取消編輯',exact:true}).click();await editor().waitFor({state:'hidden'});assert.equal(queue.state.queuedMessages[0].text,'有附件原文');
   await row().getByRole('button',{name:'編輯',exact:true}).click();await editor().fill('保留附件的新文');await row().getByRole('button',{name:'儲存',exact:true}).click();await editor().waitFor({state:'hidden'});
   assert.equal(queue.state.queuedMessages[0].id,attachment.id);assert.equal(queue.state.queuedMessages[0].text,'保留附件的新文');assert.deepEqual(queue.state.queuedMessages[0].attachmentIds,['fake-file']);assert(await row().getByRole('button',{name:'立即送入',exact:true}).isDisabled());
   await queue.enqueue({text:'立即送入的新文'});await emit();const last=page.locator('.queued-message').last();await last.getByRole('button',{name:'編輯',exact:true}).click();await editor().fill('編輯後立即送入');await last.getByRole('button',{name:'儲存',exact:true}).click();await editor().waitFor({state:'hidden'});await last.getByRole('button',{name:'立即送入',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.queued-message').length===1);
   assert.deepEqual(calls.at(-1),{method:'steer',text:'編輯後立即送入'});assert.equal(queue.state.queuedMessages[0].id,attachment.id);
   const uncertain=await queue.enqueue({text:'uncertain'});await assert.rejects(queue.action({id:uncertain.id,action:'send-now'}),/unknown/);await emit();await page.locator('.queued-message').last().getByText('狀態待確認',{exact:true}).waitFor();assert(await page.locator('.queued-message').last().getByRole('button',{name:'編輯',exact:true}).isDisabled());
   await page.screenshot({path:path.join(output,`${scale}-${theme}-saved.png`)});
   assert(requests.filter(r=>r.endpoint==='/api/queue').every(r=>r.data.threadId===A.threadId));
   results.push({width,height,scale,theme,geometry,calls,passed:true});
  }finally{live=false;await queue.close();await page.close();}
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:results.length,errors}));
}finally{await writeFile(path.join(output,'result.json'),JSON.stringify({results,errors},null,2));await browser?.close();await server.httpServer.close();}
