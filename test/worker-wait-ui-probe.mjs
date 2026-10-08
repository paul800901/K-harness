// Real built UI; entirely synthetic state and no model or production requests.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const out=path.resolve('.runtime/core-catalog-audit-20261008/wait-ui');await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5196,strictPort:true}}),errors=[],results=[];let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const [width,height,scale,theme] of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark'],[390,844,100,'warm']]){
  const page=await browser.newPage({viewport:{width,height}}),requests=[],now=Date.now();page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  const workers=[{requestId:'flash-1',provider:'gemini',model:'gemini-3.8-flash',task:'假資料：檢查第一段',status:'running',settled:false,activity:{lastEventAt:now-2000,startedAt:now-10000,phase:'tool'}},
   {requestId:'native-2',provider:'codex',model:'gpt-6-luna',task:'假資料：待讀回工單',status:'unresolved',settled:false,error:'原生連線狀態無法確認'},
   {requestId:'failed-3',provider:'gemini',task:'假資料：已失敗工單',status:'failed',settled:true,error:'fixture failure'}];
  const details=workers.map(w=>({...w,conversationId:'room-a',conversationTitle:'假資料聊天室'}));
  const base={threadId:'room-a',workspace:process.cwd(),title:'等待與活動測試',provider:'codex',model:'gpt-6-luna',status:'completed',busy:false,capabilities:{},tools:[],artifacts:[],questions:[],notices:[],workers,workerDetails:details,workerActivity:{running:1,uncertain:true,unconfirmed:1},conversationActivity:[],messages:[{id:'u',role:'user',text:'假資料，不操作真實工作。'},{id:'a',role:'assistant',text:'已派出工作，等待回報。'}]};
  await page.addInitScript(({base,now,scale,theme})=>{window.testNow=now;Date.now=()=>window.testNow;localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);window.EventSource=class{constructor(){window.testDisconnect=()=>this.onerror?.();window.testState=s=>{this.onopen?.();this.onmessage?.({data:JSON.stringify({type:'snapshot',state:s})});};setTimeout(()=>window.testState(base),0);}close(){}};},{base,now,scale,theme});
  await page.route('**/api/**',route=>{requests.push(route.request().method());const p=new URL(route.request().url()).pathname;return route.fulfill({json:p==='/api/state'?base:p==='/api/projects'?{projects:[]}:p==='/api/sessions'?{sessions:[]}:p==='/api/models'?{models:[]}:p.endsWith('/auth')?{available:false}:{}});});
  const header=page.locator('header .work-status'),footer=page.locator('.working-indicator'),trigger=page.locator('.worker-activity');
  await page.goto('http://127.0.0.1:5196');await footer.filter({hasText:'主代理待命 · 子代理未結束：2 個 · 待確認：1'}).waitFor();await trigger.click();
  const quick=page.getByRole('dialog',{name:'子代理狀態'});await quick.getByText('flash-1',{exact:true}).waitFor();await quick.getByText('native-2',{exact:true}).waitFor();
  await page.evaluate(now=>window.testNow=now+300000,now);
  await quick.getByText(/已 5 分 2 秒無新活動回報/).waitFor();
  await footer.filter({hasText:'久未回報：1'}).waitFor();
  const checked={...base,workerDetails:details.map(w=>w.requestId==='flash-1'?{...w,lastToolName:'view_file',inspection:{checkedAt:now+300000,lastActivityAt:now-2000,reason:'久無新活動，查詢仍未結束；不能據此判定卡死，未停止或重送。'}}:w)};
  await page.evaluate(s=>window.testState(s),checked);await quick.getByRole('button',{name:'查看詳細',exact:true}).click();
  const panel=page.getByRole(width<700?'dialog':'complementary',{name:'成果與工作面板'});await panel.waitFor();
  const firstCard=panel.locator('.worker-card').first();await firstCard.locator('.worker-diagnostics summary').click();
  await firstCard.getByText('久無活動檢查',{exact:true}).waitFor();await firstCard.getByText('view_file',{exact:true}).waitFor();
  await firstCard.getByText(/不能據此判定卡死/).waitFor();
  const overflow=await panel.evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,inner:innerWidth,overflow:e.scrollWidth>e.clientWidth+1};});assert(overflow.left>=0&&overflow.right<=overflow.inner&&!overflow.overflow,JSON.stringify(overflow));
  assert.equal(await panel.getByText('假資料：已失敗工單',{exact:true}).count(),1);assert.equal(await panel.locator('.worker-card').count(),3);
  await page.getByRole('button',{name:width<700?'回到聊天室':'收合工作面板',exact:true}).click();
  await page.screenshot({path:path.join(out,`${width}-${scale}-quiet.png`)});
  const fresh={...base,workerDetails:details.map(w=>w.requestId==='flash-1'?{...w,activity:{...w.activity,lastEventAt:now+300000}}:w)};
  await page.evaluate(s=>window.testState(s),fresh);await trigger.click();await quick.getByText('等待工具回報 · 最近活動 0 秒前',{exact:true}).waitFor();
  assert(!(await footer.textContent()).includes('久未回報'));
  await page.evaluate(()=>window.testDisconnect());await trigger.getByText('子代理 · 狀態待確認',{exact:true}).waitFor();await quick.getByText(/連線未確認/).waitFor();
  await page.keyboard.press('Escape');await quick.waitFor({state:'hidden'});
  await page.evaluate(s=>window.testState({...s,threadId:'room-b',workerDetails:s.workerDetails}),base);await header.waitFor({state:'detached'});await footer.waitFor({state:'detached'});assert.equal(await footer.count(),0,'another room is not waiting on these workers');
  await page.evaluate(s=>window.testState({...s,status:'failed',workers:[],workerDetails:[]}),base);if(width>=700)await header.filter({hasText:'工作失敗'}).waitFor();assert.equal(await footer.count(),0,'no duplicate idle terminal indicator');
  await page.evaluate(s=>window.testState({...s,workers:[],workerDetails:[],completionPending:true,goalPending:true}),base);await footer.filter({hasText:'等待結果交接'}).waitFor();assert(!(await footer.textContent()).includes('子代理'));
  assert.equal(requests.includes('POST'),false,'no inference, stop or replay from any clock or view action');
  results.push({width,height,scale,theme,passed:true,noPost:true});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
