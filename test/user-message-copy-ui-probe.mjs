import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
import {formatResponseAnnotations} from '../frontend/response-annotations.mjs';
const out=path.resolve('.runtime/user-message-copy-ui');await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5204,strictPort:true}}),results=[];let browser;
const text='  我的原文：繁體中文\n第二行 **不是轉成 HTML**\nhttps://example.test/a?q=1&x=2  ';
const quoted=formatResponseAnnotations('照這段修改。',[{sourceMessageId:'hidden-source-id',text:'引用來源原文',annotation:'這是我的註解'}]);
const expectedQuote='照這段修改。\n\n引用段落 1\n引用來源原文\n\n我的註解\n這是我的註解';
const fakeFiles=[{id:'fake-file',name:'假附件.txt'}],messages=[
 {id:'plain',role:'user',text},
 {id:'quoted',role:'user',text:quoted},
 {id:'handoff',role:'user',text:'INTERNAL_HANDOFF_CONTEXT',discussionHandoff:true,displayText:'請接著討論',attachments:fakeFiles},
 {id:'attachment',role:'user',text:'',attachments:fakeFiles},
 {id:'luna-completion-fake',role:'user',text:'INTERNAL_WORKER_RESULT',kind:'worker-completion',summary:'測試工人完成'},
 {id:'reply',role:'assistant',text:'助理複製仍有效。',completedAt:'2026-10-09T01:00:00Z'},
];
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'D:/K-harness/.runtime/playwright-browsers/chromium-1246/chrome-win64/chrome.exe'});
 for(const provider of ['codex','claude','gemini'])for(const [theme,width] of [['warm',1920],['light',390],['dark',390]]){
  const state={provider,threadId:'fake-room',workspace:process.cwd(),title:'使用者複製測試',model:provider==='codex'?'gpt-6-luna':provider==='claude'?'claude-opus-5-5':'gemini-3.8-flash',status:'ready',busy:false,messages,tools:[],questions:[],notices:[],workers:[],artifacts:[],queuedMessages:[],capabilities:{}},posts=[],errors=[];
  const page=await browser.newPage({viewport:{width,height:1080}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({state,theme})=>{localStorage.setItem('k-color-theme',theme);window.copyWrites=[];window.rejectCopy=false;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.rejectCopy)throw Error('fixture clipboard unavailable');window.copyWrites.push(text);}}});window.emitCopyState=s=>window.copySource?.onmessage?.({data:JSON.stringify({type:'snapshot',state:s})});window.EventSource=class{constructor(){window.copySource=this;setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state})}),0)}close(){}};},{state,theme});
  await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());if(req.method()==='POST')posts.push(u.pathname);await route.fulfill({json:u.pathname==='/api/state'?state:u.pathname==='/api/sessions'?{sessions:[]}:u.pathname==='/api/projects'?{projects:[]}:u.pathname==='/api/models'?{models:[]}:{}});});
  await page.goto('http://127.0.0.1:5204');const users=page.locator('.user-message');await users.first().waitFor();assert.equal(await users.count(),4);assert.equal(await page.locator('.worker-event button').count(),0);
  const plain=users.nth(0),button=plain.getByRole('button',{name:'複製',exact:true});await button.click();await plain.getByRole('button',{name:'已複製',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.copyWrites.at(-1)),text);
  await page.evaluate(()=>window.rejectCopy=true);await plain.getByRole('button',{name:'已複製',exact:true}).click();await plain.getByRole('button',{name:'複製失敗，請重試',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.copyWrites.length),1);await page.evaluate(()=>window.rejectCopy=false);await plain.getByRole('button',{name:'複製失敗，請重試',exact:true}).click();await plain.getByRole('button',{name:'已複製',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.copyWrites.at(-1)),text);
  await users.nth(1).getByRole('button',{name:'複製',exact:true}).click();await users.nth(1).getByRole('button',{name:'已複製',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.copyWrites.at(-1)),expectedQuote);
  await users.nth(2).getByRole('button',{name:'複製',exact:true}).click();await users.nth(2).getByRole('button',{name:'已複製',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.copyWrites.at(-1)),'請接著討論');assert.equal(await users.nth(3).getByRole('button',{name:'複製',exact:true}).count(),0);
  await page.locator('.assistant-message').getByRole('button',{name:'複製',exact:true}).click();await page.locator('.assistant-message').getByRole('button',{name:'已複製',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.copyWrites.at(-1)),'助理複製仍有效。');
  await page.evaluate(state=>window.emitCopyState({...state,busy:true,status:'working'}),state);await plain.getByRole('button',{name:'已複製',exact:true}).click();assert.equal(await page.evaluate(()=>window.copyWrites.at(-1)),text);
  const bubbleText=await plain.locator('.user-bubble').textContent();assert.equal(bubbleText,text);assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);await plain.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`${provider}-${theme}-${width}.png`)});
  results.push({provider,theme,width,plainExact:true,quoteHumanReadable:true,handoffOnlyVisibleText:true,attachmentOnlyNoEmptyCopy:true,workerNotUser:true,assistantUnchanged:true,failureAndRetry:true,copyWhileBusy:true,recordUnchanged:true,backendPosts:posts,errors});await page.close();
 }
 await writeFile(path.join(out,'result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({ok:true,cases:results.length,out}));
}finally{await browser?.close();await server.httpServer.close();}
