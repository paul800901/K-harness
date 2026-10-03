// Built-UI behavior probe for the compact native-model picker.
// Uses a headless Edge instance and intercepted fake APIs only; /api/open is
// captured by this page and never reaches a provider or sends a model turn.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {preview} from 'vite';
import {modelProvider} from '../shared/model-provider.mjs';

const root=new URL('..',import.meta.url).pathname.replace(/^\/(\w:)/,'$1').replaceAll('/','\\');
const port=5190,origin=`http://127.0.0.1:${port}`;
const server=await preview({preview:{host:'127.0.0.1',port,strictPort:true}});
const models=[
 ...['3.8-flash','3.7-flash','3.6-flash','3.1-pro'].map(name=>({model:`gemini-${name}`,displayName:`Gemini ${name.replace('-',' ').replace(/flash|pro/u,s=>s[0].toUpperCase()+s.slice(1))}`,provider:'gemini',supportedReasoningEfforts:(name.endsWith('pro')?['high','low']:['high','medium','low']).map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:'high'})),
 {model:'gpt-5.6-terra',displayName:'GPT-5.6 Terra',provider:'codex',supportedReasoningEfforts:['low','high'].map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:'low'},
 {model:'claude-haiku-4-5',displayName:'Claude Haiku 4.5',provider:'claude',description:'English catalog prose must not appear',supportedReasoningEfforts:[{reasoningEffort:'low'}]},
 {model:'gpt-6-sol',displayName:'GPT-6 Sol',provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low'},
 {model:'claude-opus-4-1',displayName:'Claude Opus 4.1',provider:'claude',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},
 {model:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',provider:'codex',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'},{reasoningEffort:'ultra'}],defaultReasoningEffort:'high'},
 {model:'claude-sonnet-5-5',displayName:'Claude Sonnet 5.5',provider:'claude',description:'Requires usage credits for this model',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'xhigh'}]},
 {model:'gpt-6-astra',displayName:'GPT-6 Astra',provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'low'}]},
 {model:'claude-opus-5-2',displayName:'Claude Opus 5.2',provider:'claude',supportedReasoningEfforts:[{reasoningEffort:'low'}]},
 {model:'gpt-5.6-astra',displayName:'GPT-5.6 Astra',provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'low'}]},
 {model:'claude-fable-5-1',displayName:'Claude Fable 5.1',provider:'claude',supportedReasoningEfforts:[{reasoningEffort:'medium'}]},
 {model:'gpt-6-luna',displayName:'GPT-6 Luna',provider:'codex',supportedReasoningEfforts:['low','medium','high','xhigh','max'].map(reasoningEffort=>({reasoningEffort}))},
 {model:'claude-sonnet-4-5',displayName:'Claude Sonnet 4.5',provider:'claude',supportedReasoningEfforts:[{reasoningEffort:'low'}]},
 {model:'gpt-future-official',displayName:'GPT Future Official',provider:'codex',description:'Official English description',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'ultra'}]},
 {model:'claude-future-official',displayName:'Claude Future Official',provider:'claude',description:'Future English description',supportedReasoningEfforts:[{reasoningEffort:'ultra'},{reasoningEffort:'bespoke-v2'}]},
].map(m=>({...m,inputModalities:['text','image']}));
const state={threadId:null,workspace:root,status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',provider:'codex',capabilities:{},conversationActivity:[]};
const requests=[];let codexLoggedIn=true,claudeLoggedIn=true,claudeLogin={status:'idle'},browser;
const auth=provider=>provider==='claude'?{available:true,version:'2.1.285',auth:{loggedIn:claudeLoggedIn,authMethod:claudeLoggedIn?'claude.ai':undefined,apiProvider:claudeLoggedIn?'firstParty':undefined,subscriptionType:claudeLoggedIn?'pro':undefined},login:claudeLogin}:{available:true,auth:{loggedIn:codexLoggedIn,authMethod:codexLoggedIn?'chatgpt':undefined,planType:codexLoggedIn?'Plus':undefined},login:{status:'idle'}};
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),pageErrors=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.addInitScript(initial=>{window.EventSource=class{constructor(){window.__fakeState=next=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:next})});setTimeout(()=>window.__fakeState(initial),0);}close(){}};},state);
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),data=request.method()==='POST'?request.postDataJSON():undefined;
  if(request.method()==='POST')requests.push({path:url.pathname,data});
  let body={};
  if(url.pathname==='/api/state')body=state;
  else if(url.pathname==='/api/projects')body={projects:[{path:root,name:'假工作區'}]};
  else if(url.pathname==='/api/sessions')body={sessions:[]};
  else if(url.pathname==='/api/models')body={models};
  else if(url.pathname==='/api/codex/auth')body=auth('codex');
  else if(url.pathname==='/api/claude/auth')body=auth('claude');
  else if(url.pathname==='/api/gemini/auth')body={installed:true,available:true,version:'fixture',auth:{status:'managed-by-cli'},reason:'登入由官方程式管理。'};
  else if(url.pathname==='/api/gemini/login')body={login:{status:'opened'},reason:'已開啟官方 Antigravity；請由本人完成登入。'};
  else if(url.pathname==='/api/claude/login')body={...auth('claude'),login:claudeLogin};
  else if(url.pathname==='/api/open'){
   // Fake provider boundary: return local fixture state; never call a host or send a model turn.
   Object.assign(state,{threadId:'fake-picker-thread',messages:[{id:'fake-history',role:'user',text:'fixture history'}],model:data.model,effort:data.effort??null,provider:modelProvider(data.model),status:'ready',accessMode:data.accessMode??'workspace-write',efforts:models.find(m=>m.model===data.model)?.supportedReasoningEfforts?.map(e=>e.reasoningEffort)??[],workerPolicy:data.workerPolicy});
   body={threadId:state.threadId};
   setTimeout(()=>page.evaluate(s=>window.__fakeState?.(s),state).catch(()=>{}),0);
  }else if(url.pathname==='/api/model'){
   body={model:data.model};
  }else if(url.pathname==='/api/claude/login/cancel'){
   claudeLogin={status:'idle'};body=auth('claude');
  }else if(url.pathname==='/api/codex/login/cancel')body=auth('codex');
  else if(url.pathname==='/api/claude/login')body={...auth('claude'),login:claudeLogin};
  await route.fulfill({json:body});
 });
 await page.goto(origin);
 await page.getByRole('button',{name:'新對話',exact:true}).click();

 const provider=page.getByRole('group',{name:'選擇主代理提供者',exact:true});
 const mainModel=page.getByRole('button',{name:'主代理模型',exact:true});
 const effort=page.getByLabel('主代理推理程度',{exact:true});
 await mainModel.waitFor();assert.equal(await mainModel.getAttribute('aria-haspopup'),'menu');
 assert.equal(await effort.evaluate(el=>el.tagName),'SELECT');
 const workerDetails=page.locator('details').filter({has:page.locator('summary[aria-label="子代理設定"]')});
 assert.equal(await workerDetails.count(),1);assert.equal(await workerDetails.evaluate(el=>el.open),false);
 await workerDetails.locator('summary').click();
 const workerModel=page.getByLabel('子代理模型',{exact:true}),workerEffort=page.getByLabel('子代理推理程度',{exact:true});
 await workerModel.waitFor();assert.equal(await workerModel.inputValue(),'auto');assert.equal(await workerEffort.count(),0);assert.match(await workerDetails.locator('summary').textContent(),/AI 自動選擇/);await workerModel.selectOption('gpt-6-luna');assert.equal(await workerEffort.count(),1);await workerModel.selectOption('auto');assert.equal(await workerEffort.count(),0);await workerModel.selectOption('gpt-6.1-sol');await workerEffort.selectOption('ultra');
 await workerDetails.locator('summary').click();assert.equal(await workerDetails.evaluate(el=>el.open),false);

 // Logged-in normal state stays collapsed; credentials/status controls remain available on expansion.
 const accountDetails=page.locator('details').filter({has:page.locator('summary[aria-label="帳號連線"]')});
 assert.equal(await accountDetails.count(),1);assert.equal(await accountDetails.evaluate(el=>el.open),false);
 await accountDetails.locator('summary').click();
 await page.getByRole('button',{name:'刷新狀態'}).first().waitFor();
 const loggedInButtons=await accountDetails.getByRole('button',{name:/登入 GPT \/ Codex|登入 Claude 訂閱/}).all();
 assert.equal(loggedInButtons.length,2,'login entry buttons should remain available as disabled controls when authenticated');
 for(const button of loggedInButtons)assert.equal(await button.isDisabled(),true,'authenticated account login action should be disabled');
 await accountDetails.locator('summary').click();

 // Ensure popover has the expected accessible contract and retains every supplied model.
 await mainModel.click();
 const menu=page.getByRole('menu',{name:'主代理模型選單',exact:true});await menu.waitFor();
 const itemNames=await menu.getByRole('menuitemradio').allTextContents();
 const normalized=itemNames.map(s=>s.replace(/\s+/g,' ').trim());
 const expectedCodex=['GPT-6.1 Sol','GPT-6 Sol','GPT-6 Astra','GPT-5.6 Astra','GPT-6 Luna','GPT-5.6 Terra','GPT Future Official'];
 for(const name of expectedCodex)assert(normalized.some(value=>value.includes(name)),`missing model ${name}: ${normalized.join(' | ')}`);
 assert.equal(await menu.getByRole('menuitemradio').count(),expectedCodex.length,'unexpected or missing selectable GPT catalog model');
 for(const item of await menu.getByRole('menuitemradio').all())assert.notEqual(await item.getAttribute('aria-disabled'),'true','official GPT model is not selectable');
 for(const group of ['Sol','Astra','Luna','Terra','其他'])assert.equal(await menu.getByRole('group',{name:group,exact:true}).count(),1,`missing group ${group}`);
 const radioOrder=async()=> (await menu.getByRole('menuitemradio').allTextContents()).map(s=>s.replace(/\s+/g,' ').trim());
 const codexOrder=await radioOrder();
 assert.equal(await menu.getByRole('menuitemradio',{checked:true}).count(),1,'selected model is not exposed as the sole checked radio');
 assert.equal(await menu.getByRole('menuitemradio',{name:'GPT-6.1 Sol',exact:true}).getAttribute('aria-checked'),'true','selected model radio state does not match');
 assert(codexOrder.findIndex(s=>s.includes('GPT-6.1 Sol'))<codexOrder.findIndex(s=>s.includes('GPT-6 Sol')),'Sol versions are not newest-first');
 assert(codexOrder.findIndex(s=>s.includes('GPT-6 Astra'))<codexOrder.findIndex(s=>s.includes('GPT-5.6 Astra')),'Astra versions are not newest-first');
 await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert.equal(await mainModel.evaluate(el=>document.activeElement===el),true,'Escape did not restore focus');
 // Exercise native keyboard navigation and commit through Enter.
 await mainModel.click();await menu.waitFor({state:'visible'});
 await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'GPT Future Official','End did not focus the last model');
 await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'GPT-6.1 Sol','Home did not focus the first model');
 await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'GPT-6 Sol','ArrowDown did not move to the next model');
 await page.keyboard.press('Enter');await menu.waitFor({state:'hidden'});
 await mainModel.click();await menu.waitFor({state:'visible'});
 assert.equal(await menu.getByRole('menuitemradio',{name:'GPT-6 Sol',exact:true}).getAttribute('aria-checked'),'true','Enter did not select the focused model');
 await menu.getByRole('menuitemradio',{name:'GPT-6.1 Sol',exact:true}).click();await menu.waitFor({state:'hidden'});
 await mainModel.click();await menu.waitFor({state:'visible'});await page.getByRole('heading',{name:'新對話',exact:true}).click();await menu.waitFor({state:'hidden'});
 await mainModel.click();await menu.waitFor();
 await provider.getByRole('button',{name:'Claude',exact:true}).click();
 const maybeHiddenMenu=page.getByRole('menu',{name:'主代理模型選單',exact:true});assert.equal(await maybeHiddenMenu.count(),0,'hidden popover should be excluded from accessible role lookup');
 await mainModel.click();
 const claudeMenu=page.getByRole('menu',{name:'主代理模型選單',exact:true});await claudeMenu.waitFor();
 const claudeItems=await claudeMenu.getByRole('menuitemradio').allTextContents(),claudeNames=claudeItems.map(s=>s.replace(/\s+/g,' ').trim());
 for(const name of ['Claude Opus 5.2','Claude Opus 4.1','Claude Sonnet 5.5','Claude Sonnet 4.5','Claude Haiku 4.5','Claude Fable 5.1','Claude Future Official'])assert(claudeNames.some(value=>value.includes(name)),`missing Claude model ${name}`);
 assert.equal(await claudeMenu.getByRole('menuitemradio').count(),7,'unexpected or missing selectable Claude catalog model');
 for(const item of await claudeMenu.getByRole('menuitemradio').all())assert.notEqual(await item.getAttribute('aria-disabled'),'true','official Claude model is not selectable');
 for(const group of ['Opus','Sonnet','Haiku','Fable','其他'])assert.equal(await claudeMenu.getByRole('group',{name:group,exact:true}).count(),1,`missing Claude group ${group}`);
 assert(claudeNames.findIndex(s=>s.includes('Claude Opus 5.2'))<claudeNames.findIndex(s=>s.includes('Claude Opus 4.1')),'Opus versions are not newest-first');
 assert.equal(await page.getByText(/English catalog prose must not appear|Future English description|Official English description/, {exact:false}).count(),0,'English catalog description leaked into UI');
 await claudeMenu.getByRole('menuitemradio',{name:'Claude Future Official',exact:true}).click();
 assert((await effort.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))).includes('bespoke-v2'),'unknown official effort was dropped');
 assert.equal(await effort.locator('option[value="bespoke-v2"]').textContent(),'bespoke-v2','unknown official effort label was rewritten');
 await mainModel.click();const creditMenu=page.getByRole('menu',{name:'主代理模型選單',exact:true});await creditMenu.waitFor({state:'visible'});
 const creditItem=creditMenu.getByRole('menuitemradio',{name:/Claude Sonnet 5\.5/});assert.equal(await creditItem.getByText('需額外用量點數',{exact:true}).count(),1,'usage-credit badge missing next to catalog option');
 await creditItem.click();await creditMenu.waitFor({state:'hidden'});
 assert.equal(await page.getByRole('note').getByText('需額外用量點數',{exact:true}).isVisible(),true,'selected model should retain its localized fee note');
 assert.equal(await page.getByText(/Requires usage credits/,{exact:false}).count(),0,'English usage-credit warning leaked');
 const claudeEffortOptions=await effort.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));assert(claudeEffortOptions.includes('xhigh'),'official effort was dropped');
 await effort.selectOption('xhigh');

 // Create is intercepted locally. Assert exact main/worker selections and one fake open only.
 await page.getByRole('button',{name:'建立對話',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="主代理模型"]')===null);
 assert.equal(requests.filter(r=>r.path==='/api/open').length,1);
 const create=requests.find(r=>r.path==='/api/open');assert.equal(create.data.model,'claude-sonnet-5-5');assert.equal(create.data.effort,'xhigh');assert.deepEqual(create.data.workerPolicy,{model:'gpt-6.1-sol',effort:'ultra'});
 assert.equal(state.threadId,'fake-picker-thread');

 // A model switch for an existing Claude conversation cannot cross to GPT.
 const switchButton=page.getByRole('button',{name:'選擇主代理模型',exact:true});
 await switchButton.click();
 const switchModel=page.getByRole('button',{name:'主代理模型',exact:true});await switchModel.waitFor();
 await switchModel.click();const switchMenu=page.getByRole('menu',{name:'主代理模型選單',exact:true});await switchMenu.waitFor();
 assert.equal(await switchMenu.getByRole('menuitemradio',{name:'GPT-6.1 Sol',exact:true}).count(),0,'switch picker allowed cross-provider model');
 await switchMenu.getByRole('menuitemradio',{name:'Claude Opus 5.2',exact:true}).click();
 await page.getByRole('button',{name:'確認切換',exact:true}).waitFor();
 await page.getByRole('button',{name:'取消',exact:true}).click();
 assert.equal(requests.filter(r=>r.path==='/api/model').length,0,'canceling model switch sent a request');

 // A fresh conversation defaults to auto even after the prior conversation chose Sol.
 await page.getByRole('button',{name:'新對話',exact:true}).click();
 const freshWorkers=page.locator('details').filter({has:page.locator('summary[aria-label="子代理設定"]')});
 await freshWorkers.locator('summary').click();
 assert.equal(await page.getByLabel('子代理模型',{exact:true}).inputValue(),'auto');
 assert.equal(await page.getByLabel('子代理推理程度',{exact:true}).count(),0);
 await page.getByRole('button',{name:'建立對話',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="主代理模型"]')===null);
 assert.deepEqual(requests.filter(r=>r.path==='/api/open').at(-1).data.workerPolicy,{model:'auto',effort:'auto'});

 // Flash worker defaults remain explicitly selected and cannot leak into GPT native agents.
 await page.getByRole('button',{name:'新對話',exact:true}).click();
 await page.getByRole('group',{name:'選擇主代理提供者'}).getByRole('button',{name:'Claude',exact:true}).click();
 await page.locator('summary[aria-label="子代理設定"]').click();
 await page.getByLabel('子代理模型',{exact:true}).selectOption('gemini-3.8-flash');
 await page.getByLabel('子代理推理程度',{exact:true}).selectOption('low');
 await page.getByRole('group',{name:'選擇主代理提供者'}).getByRole('button',{name:'GPT',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'建立對話',exact:true}).isDisabled(),true);
 await page.getByRole('group',{name:'選擇主代理提供者'}).getByRole('button',{name:'Claude',exact:true}).click();
 await page.getByRole('button',{name:'建立對話',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="主代理模型"]')===null);
 assert.deepEqual(requests.filter(r=>r.path==='/api/open').at(-1).data.workerPolicy,{model:'gemini-3.8-flash',effort:'low'});

 // Gemini is an actual third provider; native Pro choices do not invent medium.
 await page.getByRole('button',{name:'新對話',exact:true}).click();
 await page.getByRole('group',{name:'選擇主代理提供者'}).getByRole('button',{name:'Gemini',exact:true}).click();
 await mainModel.click();
 const geminiMenu=page.getByRole('menu',{name:'主代理模型選單',exact:true});await geminiMenu.waitFor();
 assert.equal(await geminiMenu.getByRole('menuitemradio').count(),4);
 await geminiMenu.getByRole('menuitemradio',{name:'Gemini 3.1 Pro',exact:true}).click();
 assert.deepEqual(await effort.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),['','high','low']);await effort.selectOption('low');
 await page.getByRole('button',{name:'新對話操作權限',exact:true}).click();
 const permissionMenu=page.getByRole('menu',{name:'操作權限選單',exact:true});
 assert.equal(await permissionMenu.getByRole('menuitemradio',{name:/代我核准|要求核准/}).count(),0);
 await permissionMenu.getByRole('menuitemradio',{name:/完整存取權/}).click();await page.getByRole('button',{name:'確認選用',exact:true}).click();
 await page.screenshot({path:'.runtime/three-core-picker.png'});
 await page.getByRole('button',{name:'建立對話',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="主代理模型"]')===null);
 const geminiCreate=requests.filter(r=>r.path==='/api/open').at(-1);assert.equal(geminiCreate.data.model,'gemini-3.1-pro');assert.equal(geminiCreate.data.effort,'low');assert.equal(geminiCreate.data.accessMode,'danger-full-access');assert.equal(geminiCreate.data.permissionConfirmed,true);
 await page.getByRole('button',{name:'選擇主代理模型',exact:true}).click();await mainModel.click();
 assert.equal(await page.getByRole('menu',{name:'主代理模型選單',exact:true}).getByRole('menuitemradio').count(),4);
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'取消',exact:true}).click();

 // Fresh fake UI with signed-out status proves login entry and Chinese cancel feedback remain.
 state.threadId=null;state.messages=[];codexLoggedIn=false;claudeLoggedIn=false;claudeLogin={status:'running',url:'https://claude.ai/oauth/authorize?fixture=1'};
 await page.reload();await page.getByRole('button',{name:'新對話',exact:true}).click();
 const signedOutAccount=page.locator('details').filter({has:page.locator('summary[aria-label="帳號連線"]')});
 await page.waitForFunction(()=>{const summary=document.querySelector('summary[aria-label="帳號連線"]');return summary?.parentElement?.open===true;});
 assert.equal(await signedOutAccount.evaluate(el=>el.open),true,'signed-out login flow should open the account details automatically');
 await page.getByRole('button',{name:'登入 GPT / Codex',exact:true}).waitFor();
 await page.getByRole('button',{name:'停止登入',exact:true}).waitFor();await page.getByRole('button',{name:'停止登入',exact:true}).click();
 assert(requests.some(r=>r.path==='/api/claude/login/cancel'),'cancel was not sent to fake API');
 await page.getByRole('button',{name:'登入 Claude 訂閱',exact:true}).waitFor();
 assert.deepEqual(pageErrors,[]);
 console.log(JSON.stringify({passed:true,checks:['accessible compact picker and native main-effort select','collapsed worker details preserve chosen official model and effort','account connection collapsed when authenticated; signed-out login auto-expands and stop-login remains available','all fake catalog models retained and grouped; numeric version order newest-first','menu Escape, Home, End, ArrowDown and Enter behavior plus focus/outside/provider dismissal','English catalog copy hidden while usage-credit badge and selected note remain localized','fake create transmits chosen model, official effort, and worker policy once without provider turn','existing-conversation switch is provider-bound; Chinese cancel sends no model request','Flash worker selected on Claude, rejected on GPT without fallback','Gemini third provider, all native models, exact Pro effort choices, explicit full access and provider-bound switch'],models:models.length,openRequests:requests.filter(r=>r.path==='/api/open').length}));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
