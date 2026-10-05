// Built UI with synthetic per-chat snapshots; never connects to formal K.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const root=process.cwd(),out=path.resolve('.runtime/compaction-20261005/ui');
await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5194,strictPort:true}}),results=[],errors=[];
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const [width,height,scale,theme]of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark']]){
  const page=await browser.newPage({viewport:{width,height}}),requests=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
  const state={threadId:'room-a',title:'壓縮次數假資料驗證',workspace:root,provider:'codex',model:'gpt-6-luna',status:'working',busy:true,messages:[],tools:[],questions:[],notices:[],artifacts:[],capabilities:{},conversationActivity:[],workerActivity:{running:3},progress:{compactions:3,compactionsComplete:true}};
  await page.addInitScript(({state,scale,theme})=>{localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);window.EventSource=class{constructor(){window.testState=s=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:s})});setTimeout(()=>window.testState(state),0);}close(){}};},{state,scale,theme});
  await page.route('**/api/**',async route=>{requests.push(route.request().method());const name=new URL(route.request().url()).pathname;await route.fulfill({json:name==='/api/state'?state:name==='/api/projects'?{projects:[{path:root,name:'假工作區'}]}:name==='/api/sessions'?{sessions:[]}:name==='/api/models'?{models:[]}:name.endsWith('/auth')?{available:false}:{}});});
  await page.goto('http://127.0.0.1:5194');const label=page.locator('header .compaction-count');await label.filter({hasText:'已壓縮 3 次'}).waitFor();
  const update=async s=>{await page.evaluate(s=>window.testState(s),s);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  for(const [threadId,progress,text]of [['room-b',{compactions:0,compactionsComplete:true},'已壓縮 0 次'],['room-old',{compactions:null,compactionsComplete:false},'壓縮次數未知'],['room-old',{compactions:12,compactionsComplete:false},'壓縮次數未知（已記錄 12 次）'],['room-a',state.progress,'已壓縮 3 次']]){
   await update({...state,threadId,progress});assert.equal(await label.textContent(),text);
   const bounds=await label.evaluate(el=>{const r=el.getBoundingClientRect(),h=el.closest('header').getBoundingClientRect();return {within:r.x>=h.x&&r.right<=h.right+1&&r.y>=h.y&&r.bottom<=h.bottom+1,overflow:el.scrollWidth>el.clientWidth+1};});
   assert.equal(bounds.within,true);assert.equal(bounds.overflow,false);
   if(threadId==='room-old'&&progress.compactions===12)await page.screenshot({path:path.join(out,`${width}-${scale}-unknown.png`)});
  }
  await page.reload();await label.filter({hasText:'已壓縮 3 次'}).waitFor();await page.screenshot({path:path.join(out,`${width}-${scale}-known.png`)});
  await update({...state,threadId:null});assert.equal(await label.count(),0);
  assert.equal(requests.includes('POST'),false);results.push({width,scale,theme,passed:true});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
