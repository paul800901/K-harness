import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

// Isolated UI fixture only: no real backend, native model or user browser profile.
const root=resolve('.'),build=resolve(process.argv[2]??'.runtime/attachment-label-20260925/build');
const output=resolve(process.argv[3]??'.runtime/attachment-label-20260925/ui');
await mkdir(output,{recursive:true});
const origin='http://127.0.0.1:5186';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--outDir',build,'--host','127.0.0.1','--port','5186','--strictPort'],{cwd:root,stdio:'ignore',windowsHide:true});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+1sAAAAASUVORK5CYII=';
const filename='畫面截圖-附件名稱很長時只顯示前段-完整名稱保留在滑鼠提示-20260925.png';
const checks=[],errors=[];
let browser;
try{
 for(let i=0;i<150;i++){try{if((await fetch(origin)).ok)break;}catch{}await delay(100);}
 browser=await chromium.launch({headless:true,executablePath:resolve(root,'.runtime/playwright-browsers/chromium-1246/chrome-win64/chrome.exe')});
 for(const provider of ['claude','codex']){
  const context=await browser.newContext({viewport:{width:1920,height:1000},reducedMotion:'reduce'}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  let state={threadId:`fake-${provider}`,workspace:'C:\\fake',title:'輕量附件標籤驗收',provider,model:provider==='claude'?'claude-opus-4-6':'gpt-6-sol',accessMode:provider==='claude'?'claude-manual':'workspace-write',status:'ready',busy:false,messages:[],questions:[],tools:[],artifacts:[],capabilities:{},conversationActivity:[]};
  const record={id:'fake-image',threadId:state.threadId,name:filename,size:Buffer.from(png,'base64').length,contentType:'image/png',kind:'image'};
  const uploads=[],sends=[],attachmentRequests=[];
  await page.addInitScript(state=>{
   localStorage.setItem('k-color-theme','warm');localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:110,dialogueFontSize:17}));
   window.__fixture=state;window.__emit=s=>{window.__fixture=s;window.__es?.onmessage?.({data:JSON.stringify(s)});};
   window.EventSource=class{constructor(){window.__es=this;setTimeout(()=>this.onmessage?.({data:JSON.stringify(window.__fixture)}),0);}close(){}};
  },state);
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/upload'){uploads.push(route.request().postDataJSON());return route.fulfill({json:record});}
   if(path==='/api/send'){
    sends.push(route.request().postDataJSON());state={...state,messages:[{id:'fake-user',role:'user',text:'看看？',attachments:[record]}]};
    await page.evaluate(s=>window.__emit(s),state);return route.fulfill({json:{sent:true}});
   }
   if(path==='/api/attachment'){attachmentRequests.push(route.request().url());return route.fulfill({body:Buffer.from(png,'base64'),headers:{'Content-Type':'image/png','Content-Disposition':'attachment; filename="fixture.png"'}});}
   return route.fulfill({json:path==='/api/sessions'?{sessions:[{threadId:state.threadId,title:state.title,workspace:state.workspace,model:state.model}]}:path==='/api/projects'?{projects:[{path:state.workspace,name:'假資料工作區'}]}:path==='/api/models'?{models:[]}:{ok:true}});
  });
  await page.goto(origin);await page.locator('.session-open').waitFor();
  const paste=()=>page.locator('.composer-input').evaluate((input,{png,filename})=>{
   const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0)),data=new DataTransfer();
   data.items.add(new File([bytes],filename,{type:'image/png'}));
   input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  },{png,filename});
  await paste();
  const draft=page.locator('.composer-card .attachment-chip');
  await draft.waitFor();await page.waitForFunction(()=>!document.querySelector('.composer-card .attachment-chip small'));
  assert.equal(await draft.getAttribute('title'),filename);assert.equal(await draft.locator('.attachment-type').innerText(),'PNG');
  assert.equal(await draft.locator('img').count(),0);
  assert.equal(await draft.locator('.attachment-name').evaluate(el=>getComputedStyle(el).textOverflow==='ellipsis'&&el.scrollWidth>el.clientWidth),true);
  assert.deepEqual(uploads[0],{threadId:state.threadId,name:filename,base64:png});
  await page.screenshot({path:resolve(output,`${provider}-draft.png`)});
  await page.getByRole('button',{name:`移除附件 ${filename}`,exact:true}).click();await draft.waitFor({state:'hidden'});
  await paste();await draft.waitFor();await page.waitForFunction(()=>!document.querySelector('.composer-card .attachment-chip small'));
  await page.getByRole('textbox',{name:'工作訊息',exact:true}).fill('看看？');
  await page.getByRole('button',{name:'送出訊息',exact:true}).click();
  const sent=page.locator('.user-message .attachment-chip');await sent.waitFor();await draft.waitFor({state:'hidden'});
  assert.equal(sends.length,1);assert.equal(sends[0].threadId,state.threadId);assert.deepEqual(sends[0].attachmentIds,[record.id]);
  assert.equal(await sent.getAttribute('title'),filename);assert.equal(await sent.locator('.attachment-type').innerText(),'PNG');
  assert.equal(await sent.locator('img').count(),0);assert.equal(await page.getByRole('dialog').count(),0);
  const href=await sent.getAttribute('href');assert.ok(href.includes(`threadId=${state.threadId}`)&&href.includes('download=1'));
  for(const theme of ['warm','light','dark'])for(const width of [1920,1024]){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   assert.equal(await sent.locator('.attachment-name').evaluate(el=>getComputedStyle(el).textOverflow==='ellipsis'&&el.scrollWidth>el.clientWidth),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:resolve(output,`${provider}-${theme}-${width}.png`)});
  }
  assert.deepEqual(attachmentRequests,[],'labels must not automatically fetch image bytes');
  const download=page.waitForEvent('download');await sent.click();assert.equal((await download).suggestedFilename(),'fixture.png');
  assert.equal(attachmentRequests.length,1);assert.equal(await page.getByRole('dialog').count(),0);
  checks.push(`${provider}: paste uploads exact PNG to source room; remove/re-paste; one send with attachment ID; sent/draft labels show type and truncated filename with full title; no image fetch/thumbnail/viewer; direct download remains; three themes and two widths`);
  await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'result.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,checks},null,2));
}finally{await browser?.close();server.kill();}
