// Built UI and event stream with fake data; no user conversations or model calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const output=path.resolve('.runtime/core-catalog-audit-20261008/ui');await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5198,strictPort:true}});
const workspace=process.cwd(),errors=[],results=[];
const state={threadId:'fake-count',workspace,status:'working',busy:true,title:'子代理數量測試',model:'gpt-6.1-sol',provider:'codex',messages:[],tools:[],questions:[],artifacts:[],workers:[],workerDetails:[],workerActivity:{running:0,uncertain:false},conversationActivity:[],accessMode:'workspace-write',capabilities:{}};
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [width,height,scale,theme]of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark'],[390,750,100,'light']]){
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
  await page.goto('http://127.0.0.1:5198');await text('子代理：0');
  await update({workerActivity:{running:7,uncertain:true,unconfirmed:3}});await text('子代理：0');
  const now=Date.now(),owner=state.threadId;
  const rows=[
   {requestId:'current-running',conversationId:owner,provider:'codex',agentNickname:'目前的核對工人',task:'x'.repeat(300),status:'running',startedAt:now-540000,lastActivityAt:now-360000,lastToolName:'Read'},
   {requestId:'current-starting',conversationId:owner,provider:'gemini',task:'正在準備',status:'starting',startedAt:new Date(now-2000).toISOString(),lastActivityAt:now},
   {requestId:'current-pending',conversationId:owner,provider:'gemini',task:'等待開始',status:'pending',lastActivityAt:now},
   {requestId:'current-unknown',conversationId:owner,provider:'claude-native',task:'狀態需要確認',status:'unresolved',settled:false,error:'原生讀回失敗'},
   {requestId:'current-approval',conversationId:owner,provider:'codex',task:'等待你的確認',status:'running',confirmationReason:'原生工具等待核准',lastActivityAt:now},
   {requestId:'other-running',conversationId:'other-chat',conversationTitle:'另一聊天室',provider:'gemini',task:'不該混入的工作',status:'running',lastActivityAt:now},
   {requestId:'current-ended',conversationId:owner,task:'已結束的工作',status:'completed',settled:true},
   {requestId:'current-history',conversationId:owner,task:'未確認舊工單',status:'unresolved',executionUnowned:true,settled:false},
  ];
  await update({workerDetails:rows});await text('子代理：5 · 待確認：1 · 久未回報：1');
  assert.equal(await page.locator('.app.inspector-hidden').count(),1,'Workers never open the inspector');
  await page.locator('.worker-activity').click();const popover=page.getByRole('dialog',{name:'子代理狀態'});
  assert.equal(await popover.locator('.worker-popover-row').count(),5);
  for(const name of ['另一聊天室','不該混入的工作','已結束的工作','未確認舊工單'])assert.equal(await popover.getByText(name,{exact:true}).count(),0);
  await popover.getByText('目前的核對工人',{exact:true}).waitFor();await popover.getByText('已耗時 9 分',{exact:false}).waitFor();await popover.getByText('最近工具：Read',{exact:true}).waitFor();
  await popover.getByText(/久未回報不等於已卡死/).waitFor();await popover.getByText(/等待核准／回答/).waitFor();
  await popover.locator('.worker-popover-row').filter({hasText:'狀態需要確認'}).locator('summary').click();await popover.getByText('原生讀回失敗',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,`current-${width}-${scale}-${theme}.png`)});
  // View switching changes only the projection, even while the popup is open.
  await update({threadId:'other-chat'});await text('子代理：1');assert.equal(await popover.locator('.worker-popover-row').count(),1);
  await popover.getByText('不該混入的工作',{exact:true}).waitFor();assert.equal(await popover.getByText('目前的核對工人',{exact:true}).count(),0);
  await update({threadId:'empty-chat'});await text('子代理：0');await popover.getByText('本聊天室目前沒有尚未結束的子代理。',{exact:true}).waitFor();
  await update({threadId:owner,workerDetails:rows.map(r=>r.requestId==='current-running'?{...r,status:'completed',settled:true}:r)});await text('子代理：4 · 待確認：1');assert.equal(await popover.locator('.worker-popover-row').count(),4);assert.equal(await popover.getByText('目前的核對工人',{exact:true}).count(),0);
  await page.evaluate(()=>window.testStream.onerror());await text(width<700?'子代理 · 待確認':'子代理：狀態待確認');
  assert.equal(await popover.locator('[data-status="running"]').count(),0);await popover.getByText(/連線未確認/).waitFor();
  await page.evaluate(state=>window.testStream.onmessage({data:JSON.stringify({type:'snapshot',state})}),{...state,status:'offline'});await text(width<700?'子代理 · 待確認':'子代理：狀態待確認');
  await page.evaluate(state=>window.testStream.onmessage({data:JSON.stringify({type:'snapshot',state})}),state);await text('子代理：0');
  await page.keyboard.press('Escape');await popover.waitFor({state:'hidden'});
  await page.locator('.worker-activity').click();await popover.waitFor();const bounds=await popover.boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1);
  await page.mouse.click(4,4);await popover.waitFor({state:'hidden'});
  const geometry=await page.locator('.worker-activity').evaluate(el=>{const r=el.getBoundingClientRect(),h=el.closest('header').getBoundingClientRect();return {rect:r.toJSON(),insideHeader:r.left>=h.left&&r.right<=h.right&&r.top>=h.top&&r.bottom<=h.bottom,unclipped:el.scrollWidth<=el.clientWidth,visible:r.width>0&&r.height>0};});assert(geometry.insideHeader&&geometry.unclipped&&geometry.visible,JSON.stringify(geometry));
  assert.equal(rows.find(r=>r.requestId==='current-history').settled,false,'Hiding history never settles it');
  results.push({width,height,scale,theme,scoped:true,endedHidden:true,unknownPreserved:true,noApiWrites:true,...geometry});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({passed:results.length,errors}));
}finally{await browser?.close();await server.httpServer.close();}
