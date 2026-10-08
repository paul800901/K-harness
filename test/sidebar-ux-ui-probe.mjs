import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createStateStream} from '../shared/state-stream.mjs';
const origin='http://127.0.0.1:5188',out=resolve('.runtime/sidebar-ux-20261009/ui');await mkdir(out,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--outDir',resolve('dist-ui'),'--host','127.0.0.1','--port','5188','--strictPort'],{stdio:'ignore',windowsHide:true});let browser;const results=[];
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()};};
try{
 for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}await delay(100);}
 browser=await chromium.launch({headless:true,executablePath:resolve(process.env.PLAYWRIGHT_BROWSERS_PATH??'D:/K-harness/.runtime/playwright-browsers','chromium-1246/chrome-win64/chrome.exe')});
 for(const [theme,provider,model] of [['light','codex','gpt-6-astra'],['warm','claude','claude-opus-5-5'],['dark','gemini','gemini-3.8-flash']])for(const width of [1920,390]){
  const page=await browser.newPage({viewport:{width,height:1080},reducedMotion:'reduce'}),workspace='C:\\fake\\workspace';
  const activity=[{threadId:'A',busy:true,status:'working',pendingQuestions:1,workspace},{threadId:'B',busy:false,status:'completed',pendingQuestions:0,workspace},{threadId:'C',busy:true,status:'working',pendingQuestions:0,workspace}];
  const base={workspace,model,provider,accessMode:'workspace-write',messages:[],tools:[],questions:[],workers:[],queuedMessages:[],artifacts:[],capabilities:{},conversationActivity:activity,completionAttention:{unread:[{threadId:'B'}]}};
  const room=(id,loading=false,history=true)=>({...base,threadId:id,title:`對話 ${id}`,status:loading?'connecting':'ready',busy:false,connectionOpening:loading,historyReady:history,messages:history?[{id:`reply-${id}`,role:'assistant',text:`僅限 ${id} 的歷史`,completedAt:'2026-01-01T00:00:00Z'}]:[]});
  const sessions=['A','B','C'].map((id,i)=>({threadId:id,title:`對話 ${id}`,workspace,model,sortAt:`2026-01-0${3-i}T00:00:00Z`}));
  const historyB=gate(),finishB=gate(),finishC=gate(),calls=[],errors=[];let startedB=false,startedC=false;
  page.on('pageerror',e=>errors.push(e.message));const stream=createStateStream(),snapshot=stream.snapshot(room('A'));const emit=async state=>{const event=stream.update(state);if(event)await page.evaluate(e=>window.__emit(e),event);};
  await page.addInitScript(({state,theme})=>{localStorage.setItem('k-color-theme',theme);window.__state=state;window.__emit=s=>{window.__state=s;window.__es?.onmessage?.({data:JSON.stringify(s)});};window.EventSource=class{constructor(){window.__es=this;setTimeout(()=>this.onmessage?.({data:JSON.stringify(window.__state)}),0);}close(){}};},{state:snapshot,theme});
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname;
   if(path==='/api/sessions')return route.fulfill({json:{sessions}});
   if(path==='/api/projects')return route.fulfill({json:{projects:[{path:workspace,name:'測試工作區'}]}});
   if(route.request().method()==='POST'){
    const data=route.request().postDataJSON();calls.push({path,threadId:data.threadId});
    if(path==='/api/open'&&data.threadId==='B'){
     startedB=true;await emit(room('B',true,false));await historyB.promise;
     if(!startedC)await emit(room('B',true));await finishB.promise;
     await emit(room('B'));return route.fulfill({json:{threadId:'B'}});
    }
    if(path==='/api/open'&&data.threadId==='C'){
     startedC=true;await finishB.promise;await emit(room('C',true));await finishC.promise;
     await emit(room('C'));return route.fulfill({json:{threadId:'C'}});
    }
   }
   return route.fulfill({json:{ok:true}});
  });
  await page.goto(origin);if(width<600)await page.getByRole('button',{name:'展開側欄',exact:true}).click();
  const rows=page.locator('.session-open');await rows.first().waitFor();
  assert.equal(await page.locator('.session-activity').filter({hasText:'待確認'}).count(),1);assert.equal(await page.locator('.session-activity.running').count(),1);assert.equal(await page.locator('.session-activity.completed-unread').count(),1);
  const icons=await page.locator('.session-activity.running svg,.session-activity.completed-unread svg').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,shape:n.innerHTML,animation:getComputedStyle(n).animationName,width:n.getBoundingClientRect().width})));assert.notEqual(icons[0].shape,icons[1].shape);assert.ok(icons.every(i=>i.animation==='none'&&i.width>=13));
  const order=await rows.allTextContents();await rows.filter({hasText:'對話 B'}).click();await page.waitForFunction(()=>document.querySelector('main header h1')?.textContent==='對話 B');
  assert.equal(await page.locator('textarea[aria-label="工作訊息"]').isDisabled(),true);assert.equal(await page.locator('.history-skeleton').count(),1);assert.equal(await page.getByText('僅限 A 的歷史',{exact:true}).count(),0);
  historyB.resolve();await page.getByText('僅限 B 的歷史',{exact:true}).waitFor();assert.equal(await page.locator('textarea[aria-label="工作訊息"]').isDisabled(),true);
  if(width<600)await page.getByRole('button',{name:'展開側欄',exact:true}).click();assert.equal(await rows.filter({hasText:'對話 C'}).isDisabled(),false);await rows.filter({hasText:'對話 C'}).click();
  await page.waitForFunction(()=>document.querySelector('main header h1')?.textContent==='對話 C');assert.equal(await page.getByText('僅限 B 的歷史',{exact:true}).count(),0);
  finishB.resolve();await page.getByText('僅限 C 的歷史',{exact:true}).waitFor();assert.equal(await page.locator('main header h1').textContent(),'對話 C');assert.equal(await page.locator('textarea[aria-label="工作訊息"]').isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'從此結論分支新對話'}).isDisabled(),true);assert.equal(await page.locator('.goal-header').count(),0);await page.screenshot({path:resolve(out,`${theme}-${width}-history.png`)});finishC.resolve();await page.waitForFunction(()=>!document.querySelector('.connection-loading'));assert.equal(await page.locator('textarea[aria-label="工作訊息"]').isDisabled(),false);
  if(width<600)await page.getByRole('button',{name:'展開側欄',exact:true}).click();assert.deepEqual(await rows.allTextContents(),order);assert.deepEqual(errors,[]);assert.equal(calls.filter(c=>['/api/send','/api/steer','/api/goal','/api/stop'].includes(c.path)).length,0);
  results.push({theme,provider,width,icons:icons.map(({shape,...i})=>i),orderUnchanged:true,latestSelection:true,readonlyHistory:true,oldContentAbsent:true,noNativeWork:true});await page.close();
 }
 await writeFile(resolve(out,'result.json'),JSON.stringify({ok:true,cases:results},null,2));console.log(JSON.stringify({ok:true,cases:results.length,out}));
}finally{await browser?.close();server.kill();}
