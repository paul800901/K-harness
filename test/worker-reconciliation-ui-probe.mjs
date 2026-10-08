// Built UI probe for historical worker reconciliation. All state and API responses are synthetic.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';

const output=path.resolve('.runtime/core-catalog-audit-20261008/reconciliation-ui');
await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5201,strictPort:true}});
const workspace=process.cwd(),errors=[],results=[];
const now=Date.now();
const workerDetails=[
 {requestId:'old-reviewed-fixture',conversationId:'fixture-room',conversationTitle:'假資料：已查核聊天室',provider:'gemini',model:'gemini-3.8-flash',task:'假資料：已查核舊工單',status:'unresolved',settled:false,executionUnowned:true,reconciliation:{summary:'僅確認這是歷史遺留工單，無法確認其執行結果。',evidence:'假資料證據：原生結果讀回不可得；沒有停止／完成證明。',reviewedAt:'2026-10-07T01:02:03.000Z'}},
 {requestId:'old-unreviewed-fixture',conversationId:'fixture-room',conversationTitle:'假資料：未查核聊天室',provider:'gemini',task:'假資料：尚待確認舊工單',status:'unresolved',settled:false,executionUnowned:true},
 {requestId:'owned-open-fixture',conversationId:'fixture-room',conversationTitle:'假資料：仍由工作階段持有',provider:'codex',model:'gpt-6.1-sol',task:'假資料：持有中的未解工單',status:'unresolved',settled:false,executionUnowned:false,error:'假資料：原生讀回尚待確認'},
 {requestId:'other-room-fixture',conversationId:'unrelated-room',conversationTitle:'假資料：另一聊天室',provider:'gemini',task:'假資料：另一來源投影',status:'unresolved',settled:false,executionUnowned:true,reconciliation:{summary:'另一聊天室的合成查核。',evidence:'不可推定已停止。',reviewedAt:'2026-10-07T01:02:03.000Z'}},
 {requestId:'ended-fixture',conversationId:'fixture-room',conversationTitle:'假資料：真正已結束工單',provider:'codex',task:'假資料：原生已完成',status:'completed',settled:true},
];
const state={threadId:'fixture-room',workspace,status:'completed',busy:false,title:'假資料：工單查核介面',model:'gpt-6.1-sol',provider:'codex',messages:[],tools:[],questions:[],artifacts:[],workers:[],workerDetails,workerActivity:{running:0,uncertain:false,unconfirmed:1,historicalUnconfirmed:1},conversationActivity:[],accessMode:'workspace-write',capabilities:{}};
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [width,height,label] of [[1440,960,'desktop'],[390,844,'mobile']]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const writes=[];page.on('request',request=>{if(request.method()!=='GET')writes.push({method:request.method(),url:request.url()});});
  await page.addInitScript(({state})=>{
   localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:100,dialogueFontSize:18}));
   localStorage.setItem('k-color-theme','light');
   window.EventSource=class{constructor(){window.testStream=this;setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state})}),0);}close(){}};
  },{state});
  await page.route('**/api/**',async route=>{
   assert.equal(route.request().method(),'GET','probe must not issue API writes');
   const endpoint=new URL(route.request().url()).pathname;
   const json=endpoint==='/api/state'?state:endpoint==='/api/projects'?{projects:[{path:workspace,name:'假資料工作區'}]}:endpoint==='/api/sessions'?{sessions:[]}:endpoint==='/api/models'?{models:[{model:state.model,displayName:'GPT-6.1 Sol',provider:'codex',supportedReasoningEfforts:[]}]}:{};
   await route.fulfill({json});
  });
  await page.goto('http://127.0.0.1:5201');
  const activity=page.locator('.worker-activity');
  await page.waitForFunction(()=>document.querySelector('.worker-activity')?.textContent.includes('子代理未結束'));
  const headerText=(await activity.textContent()).replace(/\s+/g,' ').trim();assert.doesNotMatch(headerText,/舊工單|持有中的未解工單|另一聊天室|原生已完成|假資料/);
  await activity.click();const quick=page.getByRole('dialog',{name:'子代理狀態'});await quick.waitFor();assert.equal(await quick.locator('.worker-activity-row').count(),1,'quick view shows only current live-owner unknown row');await quick.getByText('owned-open-fixture',{exact:true}).waitFor();
  await quick.getByRole('button',{name:'查看詳細',exact:true}).click();const panel=page.getByRole(width<700?'dialog':'complementary',{name:'成果與工作面板'});await panel.waitFor();
  assert.equal(await panel.locator('.worker-card').count(),4,'details retain current room task history');
  await panel.getByText('假資料：持有中的未解工單',{exact:true}).waitFor();
  for(const title of ['假資料：已查核舊工單','假資料：尚待確認舊工單','假資料：原生已完成'])await panel.getByText(title,{exact:true}).waitFor();
  assert.equal(await panel.getByText('假資料：另一聊天室',{exact:true}).count(),0,'another room stays excluded from details');
  await panel.locator('.worker-card').nth(3).getByText('已完成',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,`current-only-${label}.png`)});
  if(width<700)await page.getByRole('button',{name:'回到聊天室',exact:true}).click();
  assert.deepEqual(writes,[],'no model/work/API writes are made by rendering or inspection');
  results.push({viewport:label,width,height,headerText,historicalQuickViewHidden:true,taskHistoryRetainedInDetails:true,originalUnknownPreserved:true,sourceProjectionChecked:true,noWrites:writes.length===0});
  await page.close();
 }
 assert.deepEqual(errors,[]);
 const result={passed:true,syntheticFixturesOnly:true,modelCalls:0,apiWrites:0,results,errors,time:new Date().toISOString()};
 await writeFile(path.join(output,'reconciliation-result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}catch(error){
 const result={passed:false,syntheticFixturesOnly:true,modelCalls:0,results,errors,error:error.stack,time:new Date().toISOString()};
 await writeFile(path.join(output,'reconciliation-result.json'),JSON.stringify(result,null,2));
 throw error;
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
