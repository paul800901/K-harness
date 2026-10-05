// Built UI, fake native snapshots only. No formal K or provider requests.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const baseline=process.argv.includes('--baseline'),root=process.cwd(),out=path.resolve('.runtime/notice-research-20261005',baseline?'before-ui':'after-ui');
await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5194,strictPort:true}}),results=[],errors=[];
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const [width,height,scale,theme]of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark']]){
  const page=await browser.newPage({viewport:{width,height}}),requests=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
  const state={threadId:'room-a',title:'假資料通知驗證',workspace:root,provider:'codex',model:'gpt-6-luna',status:'working',busy:true,messages:[],tools:[],questions:[],notices:[],artifacts:[],capabilities:{},conversationActivity:[],workerActivity:{running:0}};
  await page.addInitScript(({state,scale,theme})=>{localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);window.EventSource=class{constructor(){window.testState=s=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:s})});setTimeout(()=>window.testState(state),0);}close(){}};},{state,scale,theme});
  await page.route('**/api/**',async route=>{requests.push(route.request().method());const name=new URL(route.request().url()).pathname;await route.fulfill({json:name==='/api/state'?state:name==='/api/projects'?{projects:[{path:root,name:'假工作區'}]}:name==='/api/sessions'?{sessions:[]}:name==='/api/models'?{models:[]}:name.endsWith('/auth')?{available:false}:{}});});
  await page.goto('http://127.0.0.1:5194');await page.getByRole('heading',{name:state.title}).waitFor();
  const update=async s=>{await page.evaluate(s=>window.testState(s),s);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const notices=[1,2,3,4,5].map(n=>({id:`warning-${n}`,kind:'warning',level:'warning',message:`需要處理的原生警告 ${n}`}));
  await update({...state,notices});
  const layout=await page.locator('.native-notices').evaluate(el=>({horizontal:el.scrollWidth>el.clientWidth+1,direction:getComputedStyle(el).flexDirection,height:el.getBoundingClientRect().height,rows:[...el.children].map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y}))}));
  await page.screenshot({path:path.join(out,`${width}-${scale}-warnings.png`)});
  while(await page.getByRole('button',{name:'關閉此通知',exact:true}).count())await page.getByRole('button',{name:'關閉此通知',exact:true}).first().click();
  await update({...state,threadId:'room-b',notices:[{...notices[0],message:'另一聊天室警告'}]});
  const independent=await page.getByText('另一聊天室警告',{exact:true}).count();
  await update({...state,notices});const resurrected=await page.locator('.native-notices > *').count();
  if(baseline){results.push({width,scale,layout,independent,resurrected});await page.close();continue;}
  assert.equal(layout.horizontal,false);assert.equal(layout.direction,'column');assert.ok(layout.rows.every((r,i)=>i===0||r.y>layout.rows[i-1].y));assert.equal(resurrected,0);assert.equal(independent,1);
  const retry=n=>({id:`retry-${n}`,turnId:'t',kind:'nativeError',level:'error',willRetry:true,retryKey:'episode-1',message:`Reconnecting... ${n}/5`});
  const retries=[1,2,3,4,5].map(retry),transport={id:'transport',kind:'warning',message:'Falling back from WebSockets to HTTPS transport. stream disconnected before completion'};
  await update({...state,notices:[...notices,...retries,transport]});assert.equal(await page.locator('.native-notices > *').count(),1);await page.getByText('正在重新連線（5/5）',{exact:true}).waitFor();
  await page.getByRole('button',{name:'關閉此通知',exact:true}).click();
  const waiting={...retry(6),message:'Reconnecting... waiting for network'};
  await update({...state,notices:[...retries,waiting]});assert.equal(await page.locator('.native-notices > *').count(),0,'same retry episode stays dismissed');
  await update({...state,threadId:'room-b',notices:[]});await update({...state,notices:[...retries,waiting]});assert.equal(await page.locator('.native-notices > *').count(),0);
  const fresh={...retry(1),id:'new-retry',retryKey:'episode-2'};
  await update({...state,notices:[...retries.map(n=>({...n,resolved:true})),fresh]});await page.getByText('正在重新連線（1/5）',{exact:true}).waitFor();
  await update({...state,notices:[{...fresh,resolved:true}]});assert.equal(await page.locator('.native-notices').isVisible(),false);
  const message='連線失敗：'+('原始錯誤詳細資料_'.repeat(60));
  await update({...state,status:'failed',busy:false,notices:[{id:'fatal',kind:'nativeError',level:'error',message}]});
  assert.equal(await page.locator('.native-notices [role="alert"]').count(),1);assert.equal(await page.locator('.native-notices pre').isVisible(),false);
  await page.getByText('查看詳細內容',{exact:true}).click();assert.equal(await page.locator('.native-notices pre').textContent(),message);
  assert.equal(await page.locator('.native-notices').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
  const started=Date.now()-(531*60+44)*1000,user={id:'u',role:'user',groupId:'g',turnId:'t',text:'假工作',createdAt:new Date(started).toISOString()},answer={id:'a',role:'assistant',groupId:'g',turnId:'t',text:'假工作進度',createdAt:new Date(started+1000).toISOString(),partial:true};
  await update({...state,notices:[fresh],messages:[user,answer]});await page.locator('.turn-process summary').filter({hasText:/處理中 8 小時 51 分/}).waitFor();
  await page.screenshot({path:path.join(out,`${width}-${scale}-retry-duration.png`)});
  await update({...state,status:'completed',busy:false,notices:[],messages:[user,{...answer,partial:false,completedAt:new Date(started+(86400+2*3600+3*60+4)*1000).toISOString()}]});
  await page.locator('.turn-process summary').filter({hasText:'處理了 1 天 2 小時 3 分 4 秒'}).waitFor();
  assert.equal(requests.includes('POST'),false,'display/dismiss/room switch must not send or replay work');
  results.push({width,scale,passed:true,layout,checks:['vertical notices','room-specific dismissal','single retry episode','same episode stays dismissed','new incident visible','recovery clears notice','fatal detail retained','hour/day duration','no POST']});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
