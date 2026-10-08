// Built UI probe: synthetic native state only; verifies quick activity vs. existing detail panel.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const output=path.resolve('.runtime/core-catalog-audit-20261008/ui');await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5198,strictPort:true}}),workspace=process.cwd(),errors=[],results=[];let browser;
const now=Date.now(),threadId='fixture-a';
const workers=[
 {requestId:'stable-running-001',conversationId:threadId,provider:'codex',model:'gpt-6.1-sol',agentNickname:'核對工人',task:'假任務內容不應出現在上方快覽',status:'running',settled:false,startedAt:now-90000,lastActivityAt:now-3000,lastToolName:'Read',lastReadAt:now-1000,output:'假交付摘要',outputFiles:['fixture.txt']},
 {requestId:'stable-approval-002',conversationId:threadId,provider:'claude-native',task:'核准中的假工作',status:'running',settled:false,confirmationReason:'原生工具等待核准',lastActivityAt:now-1000},
 {requestId:'stable-unknown-003',conversationId:threadId,provider:'gemini',task:'未知狀態假工作',status:'unresolved',settled:false,error:'假讀回錯誤'},
 {requestId:'other-room-004',conversationId:'fixture-b',agentNickname:'別間聊天室',task:'不得混入',status:'running',settled:false},
 {requestId:'ended-005',conversationId:threadId,task:'已完成假工作',status:'completed',settled:true},
 {requestId:'unowned-006',conversationId:threadId,task:'歷史假工作',status:'unresolved',settled:false,executionUnowned:true},
];
const state={threadId,workspace,status:'completed',busy:false,title:'合成子代理 UI 驗證',model:'gpt-6.1-sol',provider:'codex',messages:[],tools:[],questions:[],artifacts:[],workers,workerDetails:workers,workerActivity:{running:90,uncertain:true},conversationActivity:[],accessMode:'workspace-write',capabilities:{}};
try{
 browser=await chromium.launch({executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [width,height,label] of [[1440,960,'desktop'],[390,844,'mobile']]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));const writes=[];
  await page.addInitScript(({state})=>{localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:100,dialogueFontSize:18}));localStorage.setItem('k-color-theme','light');window.EventSource=class{constructor(){window.testStream=this;setTimeout(()=>{this.onopen?.();this.onmessage?.({data:JSON.stringify({type:'snapshot',state})});},0);}close(){}};},{state});
  await page.route('**/api/**',async route=>{if(route.request().method()!=='GET')writes.push(route.request().method());const p=new URL(route.request().url()).pathname;const json=p==='/api/state'?state:p==='/api/projects'?{projects:[{path:workspace,name:'合成工作區'}]}:p==='/api/sessions'?{sessions:[]}:p==='/api/models'?{models:[]}:{};await route.fulfill({json});});
  await page.goto('http://127.0.0.1:5198');const trigger=page.locator('.worker-activity');await trigger.waitFor();
  await page.locator('.working-indicator').filter({hasText:'主代理待命 · 子代理未結束：3 個 · 等待核准：1 · 待確認：1'}).waitFor();
  await page.evaluate(row=>window.testStream.onmessage({data:JSON.stringify({type:'patch',changes:{workerDetails:[row],workers:[row]}})}),workers[0]);
  await page.locator('.working-indicator').filter({hasText:'子代理仍在工作 · 主代理待命'}).waitFor();
  await page.evaluate(workers=>window.testStream.onmessage({data:JSON.stringify({type:'patch',changes:{workerDetails:workers,workers}})}),workers);
  await page.locator('.working-indicator').filter({hasText:'主代理待命 · 子代理未結束：3 個 · 等待核准：1 · 待確認：1'}).waitFor();
  const triggerText=(await trigger.innerText()).replace(/\s+/g,' ').trim();assert.match(triggerText,/子代理未結束 · 3/);assert.doesNotMatch(triggerText,/假任務|型號|codex|gemini|claude|Read|交付|錯誤/,'trigger is a concise count, not a task summary');
  await trigger.click();const quick=page.getByRole('dialog',{name:'子代理狀態'});await quick.waitFor();await quick.getByText('核對工人',{exact:true}).waitFor();await quick.getByText('等待核准／回答',{exact:false}).waitFor();
  const quickText=(await quick.innerText()).replace(/\s+/g,' ').trim();assert.doesNotMatch(quickText,/假任務|型號|codex|gemini|claude|Read|交付|錯誤|核准中的假工作/,'quick rows exclude task/provider/model/tool/details');
  assert.equal(await quick.locator('.worker-activity-row').count(),3);for(const excluded of ['別間聊天室','已完成假工作','歷史假工作'])assert.equal(await quick.getByText(excluded,{exact:true}).count(),0);
  await quick.getByRole('button',{name:'查看詳細',exact:true}).click();const panel=page.getByRole(width<700?'dialog':'complementary',{name:'成果與工作面板'});await panel.waitFor();await panel.getByRole('tab',{name:'子代理'}).waitFor();
  await panel.getByText('假任務內容不應出現在上方快覽',{exact:true}).waitFor();await panel.getByText('查看交付摘要',{exact:true}).click();await panel.getByText('假交付摘要',{exact:true}).waitFor();await panel.getByText('核准中的假工作',{exact:true}).waitFor();
  const diagnostics=panel.locator('.worker-diagnostics');await diagnostics.nth(0).locator('summary').click();await diagnostics.nth(2).locator('summary').click();await panel.getByText('假讀回錯誤',{exact:true}).waitFor();const detailText=await panel.innerText();assert.match(detailText,/狀態與查核詳細資料/);assert.match(detailText,/最近工具/);assert.match(detailText,/錯誤/);
  assert.equal(await panel.locator('.worker-card').count(),5,'details retains current-room terminal and unowned history rows while excluding another room');
  assert.equal(workers.find(w=>w.requestId==='unowned-006').settled,false,'viewing details does not rewrite historical result');
  await page.screenshot({path:path.join(output,`${label}-quick-details.png`)});
  await page.evaluate(()=>window.testStream.onmessage({data:JSON.stringify({type:'patch',changes:{threadId:'fixture-b'}})}));await page.locator('.worker-activity').getByText(/子代理仍在工作/).waitFor();
  await page.evaluate(()=>window.testStream.onmessage({data:JSON.stringify({type:'patch',changes:{threadId:'empty-room',workerDetails:[],workers:[]}})}));await page.locator('.worker-activity-zero').getByText('無未結束的子代理',{exact:true}).waitFor();assert.equal(await page.locator('.worker-activity').count(),0,'known zero is a non-clickable lightweight message');
  await page.evaluate(()=>window.testStream.onmessage({data:JSON.stringify({type:'patch',changes:{threadId:'empty-room',workerDetails:null,workers:null}})}));await page.locator('.worker-activity-zero').getByText('無未結束的子代理',{exact:true}).waitFor();
  assert.equal(await page.locator('.worker-activity').count(),0,'known zero is a non-clickable lightweight status');
  await page.evaluate(state=>window.testStream.onmessage({data:JSON.stringify({type:'snapshot',state:{...state,status:'offline'}})}),state);const unknownTrigger=page.locator('.worker-activity');await unknownTrigger.getByText('子代理 · 狀態待確認',{exact:true}).waitFor();await unknownTrigger.click();const unknownDialog=page.getByRole('dialog',{name:'子代理狀態'});await unknownDialog.waitFor();assert.equal(await unknownDialog.locator('.worker-activity-row').count(),3,'offline still exposes last-known owned rows');await unknownDialog.getByText(/連線未確認/).waitFor();
  await page.evaluate(()=>window.testStream.onerror());assert.deepEqual(writes,[],'display and navigation make no write/API requests');
  results.push({viewport:label,width,height,quickText,detailNavigation:true,roomIsolation:true,zeroAndUnknown:true,retainedHistory:true,noWrites:true});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
