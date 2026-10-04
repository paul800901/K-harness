// Built UI and event stream with fake data; no user conversations or model calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const output=path.resolve('.runtime/worker-count-20261004/ui');await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5198,strictPort:true}});
const workspace=process.cwd(),errors=[],results=[];
const state={threadId:'fake-count',workspace,status:'working',busy:true,title:'子代理數量測試',model:'gpt-6.1-sol',provider:'codex',messages:[],tools:[],questions:[],artifacts:[],workers:[],workerActivity:{running:0,uncertain:false},conversationActivity:[],accessMode:'workspace-write',capabilities:{}};
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [width,height,scale,theme]of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark']]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({state,scale,theme})=>{
   localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);
   window.EventSource=class{constructor(){window.testStream=this;setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state})}),0);}close(){}};
  },{state,scale,theme});
  await page.route('**/api/**',async route=>{
   assert.equal(route.request().method(),'GET');const endpoint=new URL(route.request().url()).pathname;
   const json=endpoint==='/api/state'?state:endpoint==='/api/projects'?{projects:[{path:workspace,name:'測試工作區'}]}:endpoint==='/api/sessions'?{sessions:[]}:
    endpoint==='/api/models'?{models:[{model:state.model,displayName:'GPT-6.1 Sol',provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]}:{};
   await route.fulfill({json});
  });
  const update=changes=>page.evaluate(changes=>window.testStream.onmessage({data:JSON.stringify({type:'patch',changes})}),changes);
  const text=expected=>page.waitForFunction(expected=>document.querySelector('.worker-activity')?.textContent===expected,expected);
  await page.goto('http://127.0.0.1:5198');await text('子代理執行中：0');
  await update({workerActivity:{running:3,uncertain:false}});await text('子代理執行中：3');
  assert.equal(await page.locator('.app.inspector-hidden').count(),1,'Count visible with inspector closed');
  await update({threadId:'other-chat',title:'另一聊天室',workers:[],workerActivity:{running:3,uncertain:false}});await text('子代理執行中：3');
  await update({workers:[{requestId:'visible-worker',status:'running'}]});
  assert.equal(await page.locator('.app.inspector-hidden').count(),1,'Workers never auto-open an otherwise empty inspector');
  await update({workerActivity:{running:2,uncertain:false}});await text('子代理執行中：2');
  await update({workerActivity:{running:0,uncertain:false}});await text('子代理執行中：0');
  await update({workerActivity:{running:2,uncertain:true}});await text('子代理：狀態待確認');
  await update({workerActivity:{running:3,uncertain:false}});await text('子代理執行中：3');
  await page.evaluate(()=>window.testStream.onerror());await text('子代理：狀態待確認');
  await update({workerActivity:{running:1,uncertain:false}});await text('子代理執行中：1');
  const geometry=await page.locator('.worker-activity').evaluate(el=>{
   const r=el.getBoundingClientRect(),h=el.closest('header').getBoundingClientRect();
   return {rect:r.toJSON(),header:h.toJSON(),insideHeader:r.left>=h.left&&r.right<=h.right&&r.top>=h.top&&r.bottom<=h.bottom,unclipped:el.scrollWidth<=el.clientWidth,visible:r.width>0&&r.height>0};
  });await page.screenshot({path:path.join(output,`${scale}-${theme}.png`)});assert(geometry.insideHeader&&geometry.unclipped&&geometry.visible,JSON.stringify({width,height,scale,...geometry}));
  await page.screenshot({path:path.join(output,`${scale}-${theme}.png`)});results.push({width,height,scale,theme,...geometry});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({passed:results.length,errors}));
}finally{await browser?.close();await server.httpServer.close();}
