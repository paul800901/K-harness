// Built UI only: synthetic messages, intercepted APIs, no provider or live K calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
import {formatResponseAnnotations} from '../frontend/response-annotations.mjs';

const out=path.resolve(process.env.K_UI_PROBE_OUT??'.runtime/long-user-text-20261013/ui');await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5218,strictPort:true}}),results=[];let browser;
const handoff='交接測試開頭\n'+Array.from({length:45},(_,i)=>`第 ${i+1} 項：核對已保存成果，只接續剩餘工作，不重播原工單。`).join('\n')+'\n交接完整尾端';
const wrapped='不換行長文字測試：'+'依目前規格核對成果與交接，只完成剩餘工作。'.repeat(140);
const messages=[
 {id:'before',role:'user',turnId:'before',text:'切換以前的短訊息'},
 {id:'handoff',role:'user',turnId:'change-1',text:handoff,attachments:[{id:'fixture-file',name:'測試交接.md'}]},
 {id:'steer',role:'user',turnId:'change-1',text:'同一回合後續補充，不是再次切換'},
 {id:'later',role:'user',turnId:'later',text:wrapped},
 {id:'second',role:'user',turnId:'change-2',text:'另一次真正切換'},
 {id:'second-steer',role:'user',turnId:'change-2',text:'第二次切換後補充'},
 {id:'discussion',role:'user',turnId:'discussion',discussionHandoff:true,displayText:handoff,text:'INTERNAL_DISCUSSION_PAYLOAD'},
 {id:'quote',role:'user',turnId:'quote',text:formatResponseAnnotations('簡短引用要求',[{sourceMessageId:'fixture-source',text:handoff,annotation:'保留原引用收合'}])},
 {id:'assistant',role:'assistant',turnId:'reply',text:'助理回覆不受本次收合影響。',completedAt:'2026-10-12T17:00:00Z'},
];
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'D:/K-harness/.runtime/playwright-browsers/chromium-1246/chrome-win64/chrome.exe'});
 for(const [width,height,theme,provider,scale] of [[1440,960,'warm','codex',100],[390,844,'light','claude',100],[1100,800,'dark','gemini',125]]){
  const state={threadId:'fake-long-user-room',workspace:process.cwd(),title:'長訊息與切換提示假資料',provider,model:'gpt-5.6-luna',status:'working',busy:true,messages,modelChanges:[{turnId:'change-1',fromModel:'gpt-6.1-sol',toModel:'gpt-5.6-luna'},{turnId:'change-2',fromModel:'gpt-5.6-luna',toModel:'gpt-6.1-sol'}],tools:[],questions:[],notices:[],workers:[],artifacts:[],queuedMessages:[],capabilities:{}},posts=[],errors=[];
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({state,theme,scale})=>{
   localStorage.setItem('k-color-theme',theme);localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));
   window.copyWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copyWrites.push(text)}});
   window.EventSource=class{constructor(){window.testSnapshot=s=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:s})});setTimeout(()=>window.testSnapshot(state),0)}close(){}};
  },{state,theme,scale});
  await page.route('**/api/**',route=>{const req=route.request(),p=new URL(req.url()).pathname;if(req.method()==='POST')posts.push(p);return route.fulfill({json:p==='/api/state'?state:p==='/api/sessions'?{sessions:[]}:p==='/api/projects'?{projects:[]}:p==='/api/models'?{models:[]}:{}});});
  await page.goto('http://127.0.0.1:5218');const users=page.locator('.user-message');await users.first().waitFor();assert.equal(await users.count(),8);
  const row=users.nth(1),text=row.locator('.user-message-text'),button=row.getByRole('button',{name:'展開全文',exact:true});
  const initial={width,provider,modelChangeNotes:await page.locator('.model-change-note').count(),handoffExpandButtons:await button.count()};
  await writeFile(path.join(out,`initial-${width}.json`),JSON.stringify(initial,null,2));
  assert.equal(initial.modelChangeNotes,2,'one note per actual model change, not each steering message');
  assert.equal(initial.handoffExpandButtons,1,'long handoff starts collapsed with an explicit expand control');
  for(const n of [0,2,3,5,6,7])assert.equal(await users.nth(n).locator('.model-change-note').count(),0);
  assert.equal(await users.nth(0).getByRole('button',{name:'展開全文',exact:true}).count(),0,'short text is not folded');
  const dimensions=await text.evaluate(e=>({height:e.clientHeight,line:parseFloat(getComputedStyle(e).lineHeight),natural:e.firstElementChild.scrollHeight,text:e.textContent}));
  await writeFile(path.join(out,`layout-${width}.json`),JSON.stringify(await text.evaluate(e=>[e,...e.querySelectorAll('*')].map(n=>{const c=getComputedStyle(n);return {tag:n.tagName,line:c.lineHeight,margin:c.margin,rect:n.getBoundingClientRect().toJSON(),max:c.maxHeight}})),null,2));
  assert(await text.evaluate(e=>Math.abs(e.getBoundingClientRect().top-e.firstElementChild.getBoundingClientRect().top)<1),'paragraph margins do not clip half a line');
  assert(dimensions.height<=8*dimensions.line+1);assert(dimensions.natural>dimensions.height*4);assert.equal(dimensions.text,handoff,'full text remains intact in the DOM');
  assert.equal(await button.getAttribute('aria-expanded'),'false');assert.equal(await button.getAttribute('aria-controls'),await text.getAttribute('id'));
  await row.getByRole('button',{name:'複製',exact:true}).click();assert.equal(await page.evaluate(()=>window.copyWrites.at(-1)),handoff,'collapsed copy includes the exact tail');
  assert.equal(await row.locator('.attachment-chip').count(),1);
  await button.focus();await button.press('Enter');const close=row.getByRole('button',{name:'收合',exact:true});await close.waitFor();assert.equal(await close.getAttribute('aria-expanded'),'true');
  assert(await text.evaluate(e=>e.clientHeight>=e.firstElementChild.scrollHeight-1));
  await page.evaluate(s=>window.testSnapshot({...s,messages:[...s.messages,{id:'live-reply',role:'assistant',text:'背景回覆持續更新',partial:true}]}),state);
  await page.getByText('背景回覆持續更新',{exact:true}).waitFor();assert.equal(await close.getAttribute('aria-expanded'),'true','background updates do not collapse the reading');
  await close.click();await button.waitFor();assert.equal(await button.evaluate(e=>document.activeElement===e),true);
  const position=await button.evaluate(e=>{const r=e.getBoundingClientRect(),v=e.closest('.viewport').getBoundingClientRect();return {top:r.top,bottom:r.bottom,viewTop:v.top,viewBottom:v.bottom}});
  assert(position.top>=position.viewTop-1&&position.bottom<=position.viewBottom+1,'collapse retains a reachable control instead of jumping to another message');
  await button.press('Space');await close.waitFor();await close.press('Space');await button.waitFor();
  const wrappedRow=users.nth(3),wrappedButton=wrappedRow.getByRole('button',{name:'展開全文',exact:true});await wrappedButton.waitFor();await wrappedRow.getByRole('button',{name:'複製',exact:true}).click();assert.equal(await page.evaluate(()=>window.copyWrites.at(-1)),wrapped);
  await users.nth(6).getByRole('button',{name:'展開全文',exact:true}).waitFor();await users.nth(6).getByRole('button',{name:'複製',exact:true}).click();assert.equal(await page.evaluate(()=>window.copyWrites.at(-1)),handoff,'discussion handoff still copies only its visible payload');
  const quote=users.nth(7).locator('.user-quote-context');assert.equal(await quote.getAttribute('open'),null);await quote.locator('summary').click();assert.notEqual(await quote.getAttribute('open'),null);assert.equal(await users.nth(7).getByRole('button',{name:'展開全文',exact:true}).count(),0,'existing quote folding is independent');await quote.locator('summary').click();
  await button.click();await close.waitFor();await page.evaluate(s=>window.testSnapshot({...s,threadId:'another-fake-room'}),state);await button.waitFor();assert.equal(await button.getAttribute('aria-expanded'),'false','another room never inherits the expanded state of a reused message id');
  // A desktop paragraph that grows beyond eight lines when the panel narrows.
  const responsive={...state,messages:[{id:'responsive',role:'user',text:'隨版面寬度重算文字。'.repeat(14)}],modelChanges:[]};
  await page.setViewportSize({width:1920,height:960});await page.evaluate(s=>window.testSnapshot(s),responsive);await page.getByText(responsive.messages[0].text,{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.user-text-toggle'));await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'展開全文',exact:true}).waitFor();
  await page.setViewportSize({width:1920,height:960});await page.waitForFunction(()=>!document.querySelector('.user-text-toggle'));
  await page.setViewportSize({width,height});await page.reload();await users.first().waitFor();await button.waitFor();assert.equal(await button.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.model-change-note').count(),2,'reload also shows each real change once');
  await row.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`${provider}-${width}-collapsed.png`)});
  await button.click();await close.waitFor();await text.evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(out,`${provider}-${width}-expanded.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
  results.push({...initial,scale,theme,exactCopy:true,keyboard:true,resize:true,reload:true,backgroundUpdate:true,quoteAndAttachmentsPreserved:true,posts,errors});await page.close();
 }
 await writeFile(path.join(out,'result.json'),JSON.stringify({ok:true,results},null,2));console.log(JSON.stringify({ok:true,cases:results.length,out}));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
