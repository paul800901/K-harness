// Built UI and fake account APIs only. No real Antigravity login or model calls.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';

const output=process.env.K_GEMINI_ACCOUNTS_PROBE_OUTPUT??path.resolve('.runtime/gemini-login-flow-20261003/ui-probe');
await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5194,strictPort:true}});
const state={threadId:null,workspace:process.cwd(),status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',provider:'codex',capabilities:{},conversationActivity:[],usage:{codex:{status:'ready',windows:[{key:'seven_day',minutes:10080,remainingPercent:81}]},claude:{status:'ready',windows:[{key:'five_hour',remainingPercent:73}]},gemini:{accountId:'acct-b',accountEmail:'b@example.test',status:'ready',checkedAt:'2026-10-03T10:00:00Z',windows:[{key:'seven_day',minutes:10080,remainingPercent:43,resetsAt:1791555046},{key:'five_hour',minutes:300,remainingPercent:62,resetsAt:1791020000}],accounts:[]}}};
const quota=(weekly,hourly,status='ready',checkedAt='2026-10-03T10:00:00Z')=>({status,checkedAt,windows:[{key:'seven_day',label:'每週',remainingPercent:weekly,resetsAt:1791555046},{key:'five_hour',label:'5 小時',remainingPercent:hourly,resetsAt:1791020000}]});
const account=(id,email,authStatus,remaining,status='ready')=>({id,email,auth:{status:authStatus,checkedAt:'2026-10-03T10:00:00Z'},quota:quota(remaining,remaining-5,status)});
let enabled=false,busy=false,uncertain=false,loginPending=false,activeAccountId=null,accounts=[],legacyLoggedIn=true,unknownAccountId=null,modelsReads=0,failFinish=false,loginHadPrevious=false,loginPreviousAccountId=null,officialLoginDuringPending=false;
let browser,authInspectPending=false;
const requests=[],errors=[];
const snapshot=()=>({enabled,activeAccountId,busy:busy||uncertain||authInspectPending,uncertain,loginPending,accounts:accounts.map(row=>({...structuredClone(row),...(row.id===unknownAccountId?{auth:{status:'unknown',checkedAt:row.auth?.checkedAt}}:{})})),...((enabled&&!uncertain)?{}:{reason:uncertain?'前次 Gemini 程序停止尚未確認；請先停止工作，再刷新確認。':'目前為預覽版本，尚未開放帳號登入與切換。'})});
const usageAccounts=()=>accounts.map(row=>({...structuredClone(row),quota:row.id==='acct-b'?quota(43,38,'stale','2026-10-02T08:00:00Z'):row.quota}));
const refreshUiState=()=>{
 state.usage.gemini={accountId:activeAccountId,accountEmail:accounts.find(row=>row.id===activeAccountId)?.email??null,status:accounts.find(row=>row.id===activeAccountId)?.quota?.status??'unavailable',checkedAt:accounts.find(row=>row.id===activeAccountId)?.quota?.checkedAt??null,windows:accounts.find(row=>row.id===activeAccountId)?.quota?.windows??[],accounts:usageAccounts()};
};
const geminiAuth=()=>({installed:true,available:legacyLoggedIn,auth:{loggedIn:legacyLoggedIn,status:legacyLoggedIn?'authenticated':'signed-out',checkedAt:'2026-10-03T10:00:00Z'},reason:legacyLoggedIn?'已驗證目前 Antigravity 登入。':'尚未登入 Gemini。'});
const respond=(route,body,status=200)=>route.fulfill({status,json:body});
const waitForReads=async(target)=>{for(let i=0;i<100&&modelsReads<target;i++)await new Promise(resolve=>setTimeout(resolve,25));assert.ok(modelsReads>=target,`expected ${target} model catalog reads, received ${modelsReads}`);};
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.setDefaultTimeout(5000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),method=request.method(),data=method==='POST'?request.postDataJSON():undefined;
  if(method==='POST')requests.push({path:url.pathname,data});
  if(url.pathname==='/api/state')return respond(route,state);
  if(url.pathname==='/api/projects')return respond(route,{projects:[{path:process.cwd(),name:'假工作區'}]});
  if(url.pathname==='/api/sessions')return respond(route,{sessions:[]});
  if(url.pathname==='/api/models'){modelsReads++;return respond(route,{models:[{model:'gemini-3.1-pro',displayName:'Gemini 3.1 Pro',provider:'gemini',available:true,inputModalities:['text'],supportedReasoningEfforts:[],nativeModels:{default:'gemini-3.1-pro'}}]});}
  if(url.pathname==='/api/codex/auth')return respond(route,{available:true,auth:{loggedIn:true,authMethod:'chatgpt',planType:'plus'}});
  if(url.pathname==='/api/claude/auth')return respond(route,{available:true,version:'2.1.287',auth:{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'}});
  if(url.pathname==='/api/gemini/auth'){if(!accounts.length){authInspectPending=true;await new Promise(resolve=>setTimeout(resolve,100));authInspectPending=false;if(loginPending)return respond(route,{error:'請先完成或取消 Gemini 登入。'},400);}return respond(route,geminiAuth());}
  if(url.pathname==='/api/usage')return respond(route,{...state.usage});
  if(url.pathname==='/api/gemini/accounts'&&method==='GET')return respond(route,snapshot());
  if(url.pathname==='/api/gemini/accounts/capture'){
   if(!enabled)return respond(route,{error:'預覽版本停用帳號保存。'},403);
   if(!legacyLoggedIn)return respond(route,{error:'目前登入尚未驗證。'},409);
   accounts=[account('acct-a','a@example.test','authenticated',76)];activeAccountId='acct-a';refreshUiState();return respond(route,snapshot());
  }
  if(url.pathname==='/api/gemini/accounts/login'){
   if(!enabled)return respond(route,{error:'預覽版本停用登入。'},403);
   if(busy)return respond(route,{error:'Gemini 正在工作。'},409);
   loginHadPrevious=legacyLoggedIn;loginPreviousAccountId=activeAccountId;
   if(loginHadPrevious&&!accounts.length){accounts=[account('acct-a','a@example.test','authenticated',76)];activeAccountId='acct-a';loginPreviousAccountId='acct-a';refreshUiState();}
   loginPending=true;activeAccountId=null;return respond(route,snapshot());
  }
  if(url.pathname==='/api/gemini/accounts/finish'){
   if(!enabled||!loginPending)return respond(route,{error:'目前沒有待完成的登入。'},409);
   if(failFinish){failFinish=false;return respond(route,{error:'尚未確認官方登入成功。'},409);}
   loginPending=false;legacyLoggedIn=true;accounts=[...accounts,account('acct-b','b@example.test','authenticated',43,'stale')];activeAccountId='acct-b';refreshUiState();return respond(route,snapshot());
  }
  if(url.pathname==='/api/gemini/accounts/cancel'){
   loginPending=false;legacyLoggedIn=loginHadPrevious||officialLoginDuringPending;if(loginHadPrevious)activeAccountId=loginPreviousAccountId;else activeAccountId=null;officialLoginDuringPending=false;refreshUiState();return respond(route,snapshot());
  }
  if(url.pathname==='/api/gemini/accounts/activate'){
   if(!enabled||busy||loginPending)return respond(route,{error:'目前無法切換帳號。'},409);
   const target=accounts.find(row=>row.id===data.accountId);if(!target||target.auth.status!=='authenticated')return respond(route,{error:'帳號尚未驗證。'},409);
   activeAccountId=target.id;refreshUiState();return respond(route,snapshot());
  }
  if(url.pathname==='/api/gemini/accounts/refresh'){
   if(uncertain){uncertain=false;busy=false;}const target=accounts.find(row=>row.id===activeAccountId);if(target){target.quota=quota(42,37,'ready','2026-10-03T11:00:00Z');}refreshUiState();return respond(route,snapshot());
  }
  return respond(route,{});
 });
 await page.goto('http://127.0.0.1:5194');
 await page.getByRole('button',{name:'設定',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'設定',exact:true});
 await settings.getByText('目前為預覽版本，尚未開放帳號登入與切換。').waitFor();
 assert.equal(await settings.getByRole('button',{name:'保存目前登入',exact:true}).isDisabled(),true);
 assert.equal(await settings.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).isDisabled(),true);
 enabled=true;await settings.getByRole('button',{name:'刷新狀態'}).filter({has:page.locator('svg')}).last().click();
 await settings.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).waitFor();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.gemini-account-row button')).some(button=>button.textContent==='新增 Gemini 帳號'&&!button.disabled));
 assert.doesNotMatch(await settings.locator('.gemini-account-row').innerText(),/Gemini 正在工作/u);
 assert.equal(await settings.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).isEnabled(),true);
 await settings.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).click();
 await settings.getByRole('button',{name:'登入完成，保存帳號',exact:true}).waitFor();
 assert.match(await settings.locator('.gemini-login-pending').innerText(),/取消前也請先關閉官方視窗/u);
 assert.match(await settings.locator('.gemini-login-pending').innerText(),/若原本未登入，取消不會撤銷你在官方程式完成的登入/u);
 assert.equal(await settings.getByRole('button',{name:'登入完成，保存帳號',exact:true}).isEnabled(),true);
 await settings.getByRole('button',{name:'取消新增',exact:true}).click();
 await settings.locator('.gemini-account-row [role="status"]').filter({hasText:'已取消新增'}).waitFor();
 assert.equal(activeAccountId,'acct-a');
 await settings.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).click();
 failFinish=true;await settings.getByRole('button',{name:'登入完成，保存帳號',exact:true}).click();
 await settings.getByText('尚未確認官方登入成功。',{exact:false}).waitFor();
 assert.equal(await settings.getByRole('button',{name:'取消新增',exact:true}).isVisible(),true);
 assert.equal(loginPending,true);
 await settings.getByRole('button',{name:'取消新增',exact:true}).click();
 await settings.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).click();
 await settings.getByRole('button',{name:'登入完成，保存帳號',exact:true}).click();
 await settings.getByText('b@example.test',{exact:true}).waitFor();
 await settings.getByText('Gemini 帳號已保存並確認登入。',{exact:true}).waitFor();
 const bCard=settings.locator('[data-account-id="acct-b"]');
 assert.match(await bCard.innerText(),/舊資料|上次查詢/u);
 assert.match(await bCard.innerText(),/目前使用/u);
 assert.equal(await bCard.getByRole('button',{name:'切換使用',exact:true}).count(),0);
 await settings.locator('[data-account-id="acct-a"]').getByRole('button',{name:'切換使用',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-account-id="acct-a"]')?.textContent.includes('目前使用 · 已驗證'));
 unknownAccountId='acct-b';await settings.getByRole('button',{name:'完成',exact:true}).click();await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);await page.reload();await page.getByRole('button',{name:'設定',exact:true}).click();
 const unknownCard=page.getByRole('dialog',{name:'設定',exact:true}).locator('[data-account-id="acct-b"]');
 await unknownCard.getByText('b@example.test').waitFor();assert.match(await unknownCard.innerText(),/尚未確認/u);assert.equal(await unknownCard.getByRole('button',{name:'切換使用',exact:true}).isEnabled(),true);
 await unknownCard.getByRole('button',{name:'切換使用',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-account-id="acct-b"]')?.textContent.includes('目前使用 · 尚未確認'));
 unknownAccountId=null;await page.getByRole('dialog',{name:'設定',exact:true}).getByRole('button',{name:'完成',exact:true}).click();await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);await page.reload();await page.getByRole('button',{name:'設定',exact:true}).click();
 busy=true;await settings.getByRole('button',{name:'完成',exact:true}).click();await page.reload();
 await page.getByRole('button',{name:'設定',exact:true}).click();
 const busySettings=page.getByRole('dialog',{name:'設定',exact:true}),busyCard=busySettings.locator('[data-account-id="acct-a"]');
 await busyCard.getByText('a@example.test').waitFor();
 assert.equal(await busyCard.getByRole('button',{name:'切換使用',exact:true}).isDisabled(),true);
 assert.equal(await busySettings.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).isDisabled(),true);
 assert.equal(await busySettings.getByRole('button',{name:'刷新目前帳號額度',exact:true}).isDisabled(),true);
 busy=false;await page.waitForFunction(()=>{const button=Array.from(document.querySelectorAll('.gemini-account-row button')).find(item=>item.textContent==='新增 Gemini 帳號');return button&&!button.disabled;});
 await busySettings.getByRole('button',{name:'完成',exact:true}).click();await page.reload();await page.getByRole('button',{name:'設定',exact:true}).click();
 uncertain=true;await settings.getByRole('button',{name:'完成',exact:true}).click();await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);await page.reload();await page.getByRole('button',{name:'設定',exact:true}).click();
 const uncertainSettings=page.getByRole('dialog',{name:'設定',exact:true}),uncertainCard=uncertainSettings.locator('[data-account-id="acct-a"]');
 assert.equal(await uncertainCard.getByRole('button',{name:'切換使用',exact:true}).isDisabled(),true);
 assert.equal(await uncertainSettings.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).isDisabled(),true);
 assert.equal(await uncertainSettings.getByRole('button',{name:'刷新目前帳號額度',exact:true}).isEnabled(),true);
 await uncertainSettings.getByRole('button',{name:'刷新目前帳號額度',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.gemini-account-row')?.textContent.includes('目前使用：b@example.test'));
 assert.equal(uncertain,false);assert.equal(busy,false);
 assert.ok(requests.some(item=>item.path==='/api/gemini/accounts/refresh'));
 await page.screenshot({path:path.join(output,'gemini-login-flow-settings.png')});
 await uncertainSettings.getByRole('button',{name:'完成',exact:true}).click();await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);await page.reload();
 assert.match(await page.locator('.usage-summary').innerText(),/b@example\.test|b@exam/u);
 assert.match(await page.locator('.usage-summary').innerText(),/2 個帳號/u);
 await page.getByRole('button',{name:'查看額度與用量詳情'}).click();
 const usage=page.getByRole('dialog',{name:'額度與用量',exact:true});
 await usage.getByText('額度與用量詳細資訊').waitFor().catch(()=>{});
 assert.equal(await usage.locator('.gemini-usage-account').count(),2);
 assert.match(await usage.locator('.gemini-usage-accounts').innerText(),/a@example\.test[\s\S]*每週[\s\S]*5 小時[\s\S]*b@example\.test/u);
 assert.match(await usage.locator('.gemini-usage-accounts').innerText(),/上次查詢|尚未更新/u);
 assert.doesNotMatch(await usage.locator('.gemini-usage-accounts').innerText(),/合計|總額/u);
 assert.match(await usage.innerText(),/Codex 訂閱剩餘額度[\s\S]*Claude 訂閱剩餘額度/u);
 await usage.getByRole('button',{name:'完成',exact:true}).click();
 activeAccountId=null;refreshUiState();await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);await page.reload();
 const modelReadsAtStart=modelsReads;await page.getByRole('button',{name:'新對話',exact:true}).click();
 const create=page.getByRole('dialog',{name:'新對話',exact:true});await create.getByRole('button',{name:'Gemini',exact:true}).click();
 await waitForReads(modelReadsAtStart+1);const modelReadsBeforeAccountChange=modelsReads;
 await page.waitForFunction(()=>{const item=document.querySelector('.provider-auth-status');return item?.open===true;});
 assert.match(await create.locator('.gemini-account-row').innerText(),/尚未選擇目前使用的帳號/u);
 assert.match(await create.locator('.account-summary').innerText(),/Gemini 尚未確認/u);
 const modelAccount=create.locator('[data-account-id="acct-a"]');await modelAccount.getByRole('button',{name:'切換使用',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.gemini-account-row')?.textContent.includes('目前使用：a@example.test'));
 await waitForReads(modelReadsBeforeAccountChange+1);
 await create.getByRole('button',{name:'取消',exact:true}).click();
 accounts=[];activeAccountId=null;legacyLoggedIn=true;loginPending=false;refreshUiState();await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);await page.reload();await page.getByRole('button',{name:'設定',exact:true}).click();
 const captureSettings=page.getByRole('dialog',{name:'設定',exact:true});
 await captureSettings.getByRole('button',{name:'保存目前登入',exact:true}).click();
 await captureSettings.getByText('a@example.test',{exact:true}).waitFor();
 assert.ok(requests.some(item=>item.path==='/api/gemini/accounts/capture'));
 accounts=[];activeAccountId=null;legacyLoggedIn=false;loginPending=false;refreshUiState();await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);await page.reload();await page.getByRole('button',{name:'設定',exact:true}).click();
 const firstLoginSettings=page.getByRole('dialog',{name:'設定',exact:true});
 await firstLoginSettings.getByText('目前尚未登入 Gemini，可直接開始新增帳號。',{exact:true}).waitFor();
 await firstLoginSettings.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).click();
 await firstLoginSettings.getByRole('button',{name:'登入完成，保存帳號',exact:true}).waitFor();
 assert.equal(accounts.length,0);assert.equal(loginHadPrevious,false);
 officialLoginDuringPending=true;
 await firstLoginSettings.getByRole('button',{name:'完成',exact:true}).click();await page.reload();await page.getByRole('button',{name:'設定',exact:true}).click();
 const pendingAfterReload=page.getByRole('dialog',{name:'設定',exact:true});
 await pendingAfterReload.getByRole('button',{name:'取消新增',exact:true}).waitFor();
 assert.match(await pendingAfterReload.locator('.gemini-login-pending').innerText(),/仍未加入 K/u);
 await pendingAfterReload.getByRole('button',{name:'取消新增',exact:true}).click();
 await pendingAfterReload.getByText('已取消新增；若已在官方程式登入，該登入仍保留，尚未加入 K。',{exact:true}).waitFor();
 assert.equal(accounts.length,0);assert.equal(activeAccountId,null);assert.equal(loginPending,false);
 assert.equal(legacyLoggedIn,true);
 await pendingAfterReload.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).waitFor();
 await page.waitForFunction(()=>{const button=Array.from(document.querySelectorAll('.gemini-account-row button')).find(item=>item.textContent==='新增 Gemini 帳號');return button&&!button.disabled;});
 assert.doesNotMatch(await pendingAfterReload.locator('.gemini-account-row').innerText(),/未安裝/u);
 assert.match(await pendingAfterReload.locator('.gemini-account-row').innerText(),/開始新增前請先關閉官方 Antigravity／agy/u);
 await pendingAfterReload.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).click();
 await pendingAfterReload.getByRole('button',{name:'登入完成，保存帳號',exact:true}).click();
 await pendingAfterReload.getByText('Gemini 帳號已保存並確認登入。',{exact:true}).waitFor();
 assert.equal(accounts.length,2);assert.equal(accounts.some(row=>row.email==='a@example.test'),true);assert.equal(activeAccountId,'acct-b');
 await pendingAfterReload.getByRole('button',{name:'新增 Gemini 帳號',exact:true}).click();
 await pendingAfterReload.getByRole('button',{name:'取消新增',exact:true}).click();
 await pendingAfterReload.getByText(/原有帳號已恢復/u).waitFor();assert.equal(activeAccountId,'acct-b');
 assert.ok(requests.some(item=>item.path==='/api/gemini/accounts/login'));
 assert.ok(!requests.some(item=>item.path==='/api/gemini/login'));
 assert.ok(!requests.some(item=>item.path==='/api/open'));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,previewWritesDisabled:true,captureAuthenticatedLogin:true,directAddFromExistingLogin:true,pendingReloadCancelReenablesAdd:true,cancelKeepsOfficialLoginUnregistered:true,firstLoginAddFinishCancel:true,loginPendingFailureRetainsCancel:true,closeOfficialWindowGuidance:true,perAccountQuotaAndStale:true,busyDisablesSwitch:true,activeAccountRefreshOnly:true,noQuotaAggregation:true,gptClaudeStillVisible:true,noConversationOrModelCalls:true,output}));
}finally{await browser?.close();await server.httpServer.close();}
