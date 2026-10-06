// Built UI, synthetic quota/account data, no provider calls or saved credentials.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';

const output=path.resolve(process.env.K_USAGE_PROBE_OUTPUT??'.runtime/usage-layout-20261003/ui-probe');
await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5197,strictPort:true}});
const quota=(weekly,hourly,status='ready')=>({status,checkedAt:'2026-10-03T12:00:00Z',windows:[{key:'seven_day',label:'每週',minutes:10080,remainingPercent:weekly,resetsAt:1791555046},{key:'five_hour',label:'5 小時',minutes:300,remainingPercent:hourly,resetsAt:1791020000}]});
const account=(id,weekly,hourly,status='ready')=>({id,email:`worker-${id}@example.test`,auth:{status:'authenticated'},quota:quota(weekly,hourly,status)});
const state={threadId:null,workspace:process.cwd(),status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',provider:'codex',capabilities:{},conversationActivity:[],usage:{claude:quota(60,94),codex:quota(9,72),gemini:{...quota(97,100),accountId:'a',accounts:[account('a',97,100),account('b',100,100,'stale'),account('c',100,100,'stale'),account('d',100,100,'stale')]}}};
let failRefresh=false,queriedValue=97;
let browser;const errors=[],requests=[],receipt={passed:false,checks:[]};
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:920}});page.setDefaultTimeout(5000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(initial=>{localStorage.setItem('k-theme','warm');window.EventSource=class{constructor(){window.fixtureEvents=this;setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);
 await page.route('**/api/**',async route=>{
  const r=route.request(),url=new URL(r.url());requests.push({method:r.method(),path:url.pathname,search:url.search});
  if(url.pathname==='/api/gemini/accounts/refresh-all'){const result=structuredClone(state.usage.gemini);result.accounts[0].quota.windows[0].remainingPercent=queriedValue;return route.fulfill({json:{activeAccountId:'a',accounts:result.accounts,note:'已查詢全部帳號並切回原帳號。'}});}
  if(url.pathname==='/api/usage'&&url.search==='?refresh=1'){if(failRefresh)return route.fulfill({status:503,json:{error:'fake offline'}});const result=structuredClone(state.usage);result.gemini.accounts[0].quota.windows[0].remainingPercent=--queriedValue;return route.fulfill({json:result});}
  const body=url.pathname==='/api/state'?state:url.pathname==='/api/usage'?state.usage:url.pathname==='/api/projects'?{projects:[]}:url.pathname==='/api/sessions'?{sessions:[]}:url.pathname==='/api/models'?{models:[]}:{};
  await route.fulfill({json:body});
 });
 await page.goto('http://127.0.0.1:5197');await page.getByRole('button',{name:'查看額度與用量詳情',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'額度與用量',exact:true}),usage=dialog.getByRole('region',{name:'額度與用量詳細資訊',exact:true});
 const rows=usage.locator('.gemini-usage-account');
 assert.deepEqual(await usage.locator('.usage-heading strong').allTextContents(),['Claude 訂閱剩餘額度','GPT / Codex 訂閱剩餘額度','Gemini / Antigravity 訂閱剩餘額度']);
 assert.equal(await rows.count(),4);assert.equal(await rows.locator('.usage-current').count(),1);assert.equal(await rows.locator('.usage-timestamps:visible').count(),0);
 const last=await rows.last().boundingBox(),done=await dialog.getByRole('button',{name:'完成',exact:true}).boundingBox();
 assert.ok(last.y+last.height<920);assert.ok(done.y+done.height<920);assert.ok(await dialog.evaluate(e=>e.scrollHeight<=e.clientHeight+1),'four-account desktop summary should not need scrolling');
 receipt.checks.push('Claude/GPT/Gemini order, four compact rows, one active badge, four accounts and Done visible without scroll');
 await page.screenshot({path:path.join(output,'usage-desktop.png')});
 const b=usage.locator('[data-account-id="b"]');assert.match(await b.innerText(),/目前額度待查詢/u);assert.deepEqual(await b.locator('.gemini-usage-value b').allTextContents(),['—','—']);
 await b.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await b.locator('.usage-timestamps').isVisible(),true);assert.match(await b.innerText(),/上次查詢.*上次回報・每週.*重設時間.*5 小時.*（已過）/su);
 await page.keyboard.press('Enter');assert.equal(await b.locator('.usage-timestamps').isVisible(),false);
 await usage.locator('.usage-more').first().locator('summary').click();assert.equal(await usage.locator('.usage-more').first().locator('.usage-timestamps').isVisible(),true);await usage.locator('.usage-more').first().locator('summary').click();
 receipt.checks.push('mouse and keyboard disclosure; stale warning visible while timestamps collapsed');
 const beforeRefresh=requests.filter(r=>r.path==='/api/usage'&&r.search==='?refresh=1').length;
 await usage.getByRole('button',{name:'更新額度與用量',exact:true}).click();
 assert.equal(requests.filter(r=>r.path==='/api/usage'&&r.search==='?refresh=1').length,beforeRefresh+1);
 await usage.locator('[data-account-id="a"]').getByText('96%',{exact:true}).waitFor();
 failRefresh=true;await usage.getByRole('button',{name:'更新額度與用量',exact:true}).click();await usage.getByRole('alert').waitFor();assert.match(await usage.getByRole('alert').innerText(),/額度查詢失敗/u);failRefresh=false;
 receipt.checks.push('manual refresh displays returned data without SSE; HTTP failure is visible, not silent success');
 const send=async()=>page.evaluate(next=>window.fixtureEvents.onmessage({data:JSON.stringify({type:'snapshot',state:next})}),state);
 state.usage.gemini.accounts[0].quota=quota(0,null);state.usage.gemini.accounts[2].auth.status='signed-out';state.usage.gemini.accounts[2].quota={status:'unavailable',windows:[]};state.usage.gemini.accounts[3].auth.status='unknown';await send();
 const a=usage.locator('[data-account-id="a"]'),c=usage.locator('[data-account-id="c"]'),d=usage.locator('[data-account-id="d"]');
 await a.getByText('0%',{exact:true}).waitFor();assert.deepEqual(await a.locator('.gemini-usage-value b').allTextContents(),['0%','—']);assert.match(await c.innerText(),/未登入.*尚無可用額度資料/su);assert.match(await d.innerText(),/尚未確認/u);
 assert.match(await a.locator('summary').innerText(),/上次實查/u);
 state.usage.gemini.accounts[0].quota.windows[1].resetsAt=Math.floor(Date.now()/1000)-1;await send();
 await a.getByText(/目前額度待查詢/u).waitFor();assert.deepEqual(await a.locator('.gemini-usage-value b').allTextContents(),['—','—']);
 state.usage.gemini.accounts[0].quota.checkedAt=new Date().toISOString();await send();
 await a.getByText('0%',{exact:true}).waitFor();assert.deepEqual(await a.locator('.gemini-usage-value b').allTextContents(),['0%','—']);
 receipt.checks.push('last-query time is always visible; crossing an official reset requires confirmation, a new official result supersedes the past reset without inventing 100%');
 await page.evaluate(()=>window.fixtureEvents.onerror());await page.waitForFunction(()=>document.querySelector('.usage-toolbar button').disabled);assert.match(await a.innerText(),/目前額度待查詢/u);
 receipt.checks.push('zero vs unknown quota, signed-out and unknown auth stay visible, offline disables refresh and marks old data; refresh invokes only the authorized all-account query action');
 await page.setViewportSize({width:390,height:844});
 assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'no horizontal scroll at narrow viewport');
 await rows.last().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'usage-narrow.png')});
 await dialog.getByRole('button',{name:'完成',exact:true}).scrollIntoViewIfNeeded();assert.equal(await dialog.getByRole('button',{name:'完成',exact:true}).isVisible(),true);
 receipt.checks.push('390px viewport wraps account identity and keeps all rows and Done reachable');
 state.usage.gemini={...quota(97,0),accounts:[]};await page.setViewportSize({width:1440,height:920});await send();
 const legacy=usage.getByRole('region',{name:'Gemini / Antigravity 訂閱剩餘額度',exact:true});assert.equal(await rows.count(),0);assert.match(await legacy.innerText(),/每週\s*97%/u);assert.match(await legacy.innerText(),/5 小時\s*0%/u);
 state.usage={};await send();await legacy.getByText('尚未取得官方額度。',{exact:true}).first().waitFor();assert.doesNotMatch(await usage.innerText(),/undefined|NaN|Invalid Date/u);
 receipt.checks.push('single unsaved Gemini account and missing-provider-data fallback');
 assert(requests.filter(r=>r.method!=='GET').every(r=>r.method==='POST'&&r.path==='/api/gemini/accounts/refresh-all'));assert.deepEqual(errors,[]);receipt.passed=true;
}catch(error){receipt.error=error.stack;throw error;}
finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));await writeFile(path.join(output,'result.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));}
