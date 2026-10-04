// Real built UI with fake accounts; no login, credentials or provider calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';

const output=path.resolve(process.env.K_MODAL_PROBE_OUTPUT??'.runtime/modal-scroll-ui-probe');
await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5198,strictPort:true}});
const quota={status:'ready',checkedAt:'2026-10-04T10:00:00Z',windows:[{key:'seven_day',remainingPercent:95},{key:'five_hour',remainingPercent:93}]};
const accounts=Array.from({length:4},(_,i)=>({id:`account-${i}`,email:`worker-${i}@example.test`,auth:{status:'authenticated',checkedAt:quota.checkedAt},quota}));
const state={threadId:null,status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],provider:'codex',workspace:process.cwd(),conversationActivity:[],usage:{}};
let browser;const errors=[],receipt={passed:false,cases:[]};
try{
 browser=await chromium.launch({executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage();page.setDefaultTimeout(6000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());assert.equal(route.request().method(),'GET','UI-only probe must not mutate anything');
  const body=url.pathname==='/api/state'?state:url.pathname==='/api/projects'?{projects:[]}:url.pathname==='/api/sessions'?{sessions:[]}:url.pathname==='/api/models'?{models:[]}:url.pathname==='/api/gemini/accounts'?{enabled:true,activeAccountId:accounts[0].id,accounts}:url.pathname.endsWith('/auth')?{available:true,auth:{loggedIn:true,status:'authenticated',authMethod:'chatgpt'}}:{};
  await route.fulfill({json:body});
 });
 await page.goto('http://127.0.0.1:5198');
 for(const [width,height,scale]of [[1920,1080,1],[1366,768,1.25],[800,600,1]]){
  await page.setViewportSize({width,height});await page.evaluate(scale=>document.documentElement.style.setProperty('--k-ui-scale',scale),scale);
  const opener=page.getByRole('button',{name:'設定',exact:true});await opener.click();
  const dialog=page.getByRole('dialog',{name:'設定',exact:true});await dialog.getByText('worker-3@example.test',{exact:true}).waitFor();
  const close=dialog.getByRole('button',{name:'關閉',exact:true}),before=await close.boundingBox();
  // Scroll the content as the user does; accept either old dialog or new body.
  const scroll=dialog.locator('.modal-body');const target=await scroll.count()?scroll:dialog;
  assert.ok(await target.evaluate(e=>e.scrollHeight>e.clientHeight),'fixture must really overflow');
  await target.evaluate(e=>{e.scrollTop=e.scrollHeight;});
  const after=await close.boundingBox();assert.ok(Math.abs(after.y-before.y)<1,'close button must remain fixed while content scrolls');
  assert.ok(after.y>=0&&after.y+after.height<height,'close must remain on screen');
  assert.ok(await target.evaluate(e=>e.scrollTop>0),'body actually scrolled');
  await page.screenshot({path:path.join(output,`settings-bottom-${width}-${scale}.png`)});
  await close.click();await dialog.waitFor({state:'hidden'});assert.equal(await opener.evaluate(e=>e===document.activeElement),true);
  receipt.cases.push({width,height,scale,headerFixed:true,closeClicked:true,focusRestored:true});
 }
 await page.getByRole('button',{name:'設定',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'設定',exact:true}).click();await page.mouse.click(5,5);await page.getByRole('dialog').waitFor({state:'hidden'});
 // A short sibling modal must still lay out, open and close normally.
 await page.getByRole('button',{name:'查看額度與用量詳情',exact:true}).click();
 const usage=page.getByRole('dialog',{name:'額度與用量',exact:true});await usage.getByRole('button',{name:'完成',exact:true}).click();await usage.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);receipt.passed=true;receipt.escapeBackdropShortDialog=true;
}catch(e){receipt.error=e.stack;throw e;}finally{await writeFile(path.join(output,'result.json'),JSON.stringify(receipt,null,2));await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
