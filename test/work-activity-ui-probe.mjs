// Built UI with fake native events and a controlled display clock. No real jobs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const root=process.cwd(),out=path.resolve('.runtime/work-activity-20261005/ui');await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5197,strictPort:true}}),errors=[],results=[];let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const [width,height,scale,theme] of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark']]){
  const page=await browser.newPage({viewport:{width,height}}),requests=[],now=Date.now(),started=now-2*3600000;
  page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  const base={threadId:'room-a',workspace:root,title:'假資料：活動與子代理狀態',provider:'codex',model:'gpt-6-luna',status:'working',busy:true,capabilities:{},tools:[],artifacts:[],questions:[],notices:[],workers:[],conversationActivity:[],workerActivity:{running:7,uncertain:true,unconfirmed:2},progress:{compactions:3,compactionsComplete:true},activity:{startedAt:started,lastEventAt:now-8000,phase:'active',phaseSince:started},messages:[{id:'u',role:'user',text:'假工作：測試活動顯示，不操作正式資料。',createdAt:new Date(started).toISOString(),groupId:'g',turnId:'t'},{id:'a',role:'assistant',text:'這段文字是合成進度。上方應顯示真實事件的新鮮度，而非用總耗時保證工作仍有進展。',createdAt:new Date(started+1000).toISOString(),groupId:'g',turnId:'t',partial:true}]};
  await page.addInitScript(({base,now,scale,theme})=>{window.testNow=now;Date.now=()=>window.testNow;localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);window.EventSource=class{constructor(){window.testDisconnect=()=>this.onerror?.();window.testState=s=>{this.onopen?.();this.onmessage?.({data:JSON.stringify({type:'snapshot',state:s})});};setTimeout(()=>window.testState(base),0);}close(){}};},{base,now,scale,theme});
  await page.route('**/api/**',route=>{requests.push(route.request().method());const p=new URL(route.request().url()).pathname;return route.fulfill({json:p==='/api/state'?base:p==='/api/projects'?{projects:[{path:root,name:'假工作區'}]}:p==='/api/sessions'?{sessions:[]}:p==='/api/models'?{models:[]}:p.endsWith('/auth')?{available:false}:{}});});
  const header=page.locator('header .work-status'),footer=page.locator('.working-indicator');
  const update=async state=>{await page.evaluate(s=>window.testState(s),state);};
  const shows=async(text)=>{await header.filter({hasText:text}).waitFor();assert.equal(await header.textContent(),text);};
  await page.goto('http://127.0.0.1:5197');await shows('執行中 · 最近活動 8 秒前');
  assert.equal(await footer.textContent(),'執行中 · 最近活動 8 秒前');
  assert.equal(await page.locator('.worker-activity-zero').textContent(),'無未結束的子代理','aggregate counters do not replace native per-worker rows');
  await page.locator('.turn-process summary').filter({hasText:'已耗時 2 小時'}).waitFor();
  // No SSE or backend update: the local timer must expose silence, not refresh it.
  await page.evaluate(now=>window.testNow=now+300000,now);await shows('工作尚未結束 · 已 5 分 8 秒無新活動回報');
  assert.equal(await header.evaluate(e=>getComputedStyle(e.querySelector('i')).animationName),'none');
  await page.screenshot({path:path.join(out,`${width}-${scale}-quiet.png`)});
  const waiting={...base,activity:{...base.activity,lastEventAt:now+299000,phase:'worker',phaseSince:now-120000}};
  await update(waiting);await shows('等待子代理回報 7 分 0 秒 · 最近活動 1 秒前');
  const long={...waiting,activity:{startedAt:now-90000000,lastEventAt:now-90000000,phase:'worker',phaseSince:now-90000000}};
  await update(long);await header.filter({hasText:'1 天 1 小時 5 分 0 秒'}).waitFor();
  const overflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth>innerWidth+1,header:document.querySelector('main>header').scrollWidth>document.querySelector('main>header').clientWidth+1}));assert.deepEqual(overflow,{body:false,header:false});
  await page.screenshot({path:path.join(out,`${width}-${scale}-long-wait.png`)});
  const retry={id:'r',kind:'nativeError',willRetry:true,retryKey:'r',level:'error',message:'Reconnecting... 2/5'};
  await update({...waiting,notices:[retry]});await shows('原生核心重連中 · 最近活動 1 秒前');
  await page.getByRole('button',{name:'關閉此通知',exact:true}).click();await shows('原生核心重連中 · 最近活動 1 秒前');
  await update({...base,threadId:'room-b',activity:null});await shows('工作狀態待確認 · 尚無核心活動回報');
  await update(waiting);await shows('等待子代理回報 7 分 0 秒 · 最近活動 1 秒前');
  await update({...waiting,questions:[{id:'q',kind:'input',questions:[]}]});await shows('等待你的確認');
  await update({...base,busy:false,status:'completed'});await header.waitFor({state:'detached'});assert.equal(await footer.count(),0);
  await update({...base,busy:false,status:'offline'});await shows('核心已斷線');
  await page.evaluate(()=>window.testDisconnect());await shows('後端斷線 · 無法確認工作狀態');
  assert.equal(await page.locator('.worker-activity').textContent(),'子代理 · 狀態待確認');
  assert.equal(requests.includes('POST'),false,'display clocks and status changes must not send/stop/replay');
  results.push({width,scale,theme,passed:true,checks:['real-event recency','time-only silence warning','explicit wait duration','partial worker count','no pulse','hour/day elapsed','no overflow','dismissed retry remains status','room switch preserves recency','confirmation','completed/connection state','no POST']});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
