// Built UI: synthetic SSE transitions and persisted-history reload. No real model or business writes.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const out=path.resolve('.runtime/steer-final-ui');await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:0}});const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const first='FIRST_COMPLETED_REPLY',second='SECOND_COMPLETED_REPLY';
let browser;const checks=[],errors=[];
try{
 browser=await chromium.launch({headless:true,channel:'msedge'});
 for(const provider of ['claude','codex','gemini'])for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}}),posts=[];page.on('pageerror',e=>errors.push(e.message));
  let current={threadId:'fake-steer-room',workspace:process.cwd(),provider,model:provider==='claude'?'claude-opus-5-5':provider==='codex'?'gpt-6.1-sol':'gemini-3.8-flash',status:'working',busy:true,accessMode:'read-only',capabilities:{},questions:[],notices:[],tools:[],workers:[],artifacts:[],progress:{},messages:[{id:'root',role:'user',groupId:'same',text:'Fake work request'},{id:'process',role:'assistant',groupId:'same',text:'PROCESS_ONLY',partial:true}]};
  await page.addInitScript(initial=>{window.EventSource=class{constructor(){window.emitTestState=s=>{sessionStorage.setItem("steerSnapshot",JSON.stringify(s));this.onopen?.();this.onmessage?.({data:JSON.stringify({type:'snapshot',state:s})});};setTimeout(()=>window.emitTestState(JSON.parse(sessionStorage.getItem("steerSnapshot")??"null")??initial),0);}close(){}};},current);
  await page.route('**/api/**',route=>{const req=route.request(),p=new URL(req.url()).pathname;if(req.method()==='POST')posts.push(p);return route.fulfill({json:p==='/api/state'?current:p==='/api/projects'?{projects:[]}:p==='/api/sessions'?{sessions:[]}:p==='/api/models'?{models:[]}:p.endsWith('/auth')?{available:false}:{}});});
  const push=async()=>page.evaluate(s=>window.emitTestState(s),current);
  await page.goto(origin);await page.locator('.assistant-response-content').filter({hasText:'PROCESS_ONLY'}).waitFor();
  current.messages.splice(1,0,{id:'untimed-history',role:'assistant',groupId:'same',text:'UNTIMED_HISTORY_PROCESS'});
  current.messages.push({id:'steer1',role:'user',groupId:'same',source:'steer',text:'Fake first interruption'},{id:'steer2',role:'user',groupId:'same',source:'steer',text:'Fake second interruption'},{id:'first',role:'assistant',groupId:'same',text:first,completedAt:'2026-10-09T00:00:01Z'});current.busy=false;current.status='completed';await push();
  await page.locator('.assistant-response-content').filter({hasText:first}).waitFor();
  current.messages.push({id:'next-process',role:'assistant',groupId:'same',text:'NEXT_IN_PROGRESS',partial:true,streaming:true});current.busy=true;current.status='working';await push();
  await page.locator('.assistant-response-content').filter({hasText:'NEXT_IN_PROGRESS'}).waitFor();assert.equal(await page.locator('.assistant-response-content').filter({hasText:first}).count(),1,'a following partial must not hide a completed reply');
  current.messages.at(-1).streaming=false;current.messages.at(-1).text=second;delete current.messages.at(-1).partial;current.messages.at(-1).completedAt='2026-10-09T00:00:02Z';current.busy=false;current.status='completed';await push();
  await page.locator('.assistant-response-content').filter({hasText:second}).waitFor();
  const assertReplies=async()=>{for(const text of [first,second]){const reply=page.locator('.assistant-message').filter({has:page.locator('.assistant-response-content').filter({hasText:text})});assert.equal(await reply.count(),1);assert.equal(await reply.locator('.assistant-response-content').getAttribute('data-aui-quote-selectable'),'true');assert.equal(await reply.getByRole('button',{name:'複製',exact:true}).count(),1);assert.equal(await reply.locator('time').count(),1);assert.equal(await reply.getByRole('button',{name:'分支',exact:true}).count(),text===second?1:0,'only the selected group conclusion may branch');}};
  await assertReplies();assert.equal(await page.locator('.assistant-response-content').filter({hasText:'UNTIMED_HISTORY_PROCESS'}).count(),0,'historical commentary without an actual completion timestamp stays in details');assert.equal(await page.locator('.turn-process').count(),1);
  await page.locator('.turn-process summary').click();const details=page.locator('.turn-process-content');await details.waitFor();assert.match(await details.textContent(),/PROCESS_ONLY/);assert.match(await details.textContent(),/UNTIMED_HISTORY_PROCESS/);assert.doesNotMatch(await details.textContent(),/FIRST_COMPLETED_REPLY|SECOND_COMPLETED_REPLY/,'completed replies do not duplicate in collapsed process details');
  await page.locator('.turn-process summary').click();
  await page.reload();await page.locator('.assistant-response-content').filter({hasText:second}).waitFor();await assertReplies();
  assert.equal(posts.length,0,'display and reload never replay work');checks.push({provider,width,midWork:true,bothCompleted:true,reload:true,posts:0});await page.screenshot({path:path.join(out,`${provider}-${width}.png`)});await page.close();
 }
 // Optional local-only acceptance of the reported saved reply, without rewriting its projection.
 if(process.env.K_INCIDENT_PROJECTION){
  const saved=JSON.parse(await readFile(process.env.K_INCIDENT_PROJECTION,'utf8')),target=saved.messages.find(m=>m.id===process.env.K_INCIDENT_MESSAGE_ID);assert(target);
  const same=saved.messages.filter(m=>m.groupId===target.groupId);
  const page=await browser.newPage({viewport:{width:1440,height:900}}),current={threadId:'local-history-readback',provider:'claude',model:'claude-opus-5-5',workspace:process.cwd(),status:'completed',busy:false,capabilities:{},questions:[],notices:[],workers:[],tools:[],artifacts:[],progress:{},messages:same.map(m=>({...m,text:m.id===target.id?m.text:m.role==='user'?'History user message':m.partial?'History process':'History later final'}))};
  await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},current);
  await page.route('**/api/**',route=>{const p=new URL(route.request().url()).pathname;return route.fulfill({json:p==='/api/state'?current:p==='/api/projects'?{projects:[]}:p==='/api/sessions'?{sessions:[]}:p==='/api/models'?{models:[]}:p.endsWith('/auth')?{available:false}:{}});});await page.goto(origin);
  const markers=(process.env.K_HISTORY_MARKERS??'PERF-20261008-001,PERF-20261008-002').split(',');const reply=page.locator('.assistant-response-content').filter({hasText:markers[0]});await reply.waitFor();const displayed=await reply.innerText();for(const marker of markers)assert.equal(displayed.includes(marker),true);if(same.filter(m=>m.role==='assistant'&&!m.partial&&!m.streaming).length>1)assert.equal(await page.locator('.assistant-response-content').filter({hasText:'History later final'}).count(),1);
  checks.push({existingHistory:true,targetId:target.id,savedContentDisplayed:true,projectionModified:false});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({passed:true,checks}));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
