// Built UI probe: synthetic model catalogs derived from the native catalog snapshot; no model/API calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {preview} from 'vite';
import {geminiModelsFrom} from '../src/gemini-controller.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),out=path.resolve(root,'.runtime/worker-model-picker-ui-20261008');
await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5208,strictPort:true}});
const efforts=names=>names.map(reasoningEffort=>({reasoningEffort}));
// Snapshot names and supported efforts correspond to native-catalogs.json (2026-10-08).
const codexIds=['gpt-6.1-sol','gpt-6-astra','gpt-6-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna'];
const codex=codexIds.map((model,index)=>({model,displayName:model.toUpperCase().replaceAll('-','-'),provider:'codex',available:true,defaultReasoningEffort:index===2||index===3||index===5||index===6?'medium':'low',supportedReasoningEfforts:efforts(index===3||index===6?['low','medium','high','xhigh','max']:['low','medium','high','xhigh','max','ultra']),...(index===0?{isDefault:true}:{})}));
const claudeSpecs=[
 ['claude-opus-5-5','Opus 5.5'],['claude-sonnet-5-5','Sonnet 5.5'],['claude-haiku-5-5','Haiku 5.5'],['claude-haiku-4-5-20251001','Haiku 4.5'],
 ['claude-sonnet-5','Sonnet 5'],['claude-opus-5','Opus 5'],['claude-opus-4-8','Opus 4.8'],['claude-opus-4-7','Opus 4.7'],['claude-opus-4-6','Opus 4.6'],['claude-sonnet-4-6','Sonnet 4.6'],
];
const claude=claudeSpecs.map(([model,displayName])=>({model,displayName,provider:'claude',available:true,supportedReasoningEfforts:model==='claude-haiku-4-5-20251001'?[]:efforts(model.endsWith('-4-6')?['low','medium','high','max']:['low','medium','high','xhigh','max'])}));
const geminiNames=['gemini-3.8-flash-high','gemini-3.8-flash-medium','gemini-3.8-flash-low','gemini-3.7-flash-high','gemini-3.7-flash-medium','gemini-3.7-flash-low','gemini-3.6-flash-high','gemini-3.6-flash-medium','gemini-3.6-flash-low','gemini-3.1-pro-high','gemini-3.1-pro-low'];
const gemini=geminiModelsFrom(geminiNames);
assert.equal(gemini.length,4);assert.deepEqual(gemini.find(row=>row.model==='gemini-3.1-pro').supportedReasoningEfforts.map(item=>item.reasoningEffort),['high','low']);
const baseModels=[...codex,...claude,...gemini];
assert.equal(baseModels.length,21,'native fixture has 7 GPT, 10 Claude, and 4 parser-aggregated Gemini choices');
const futureGPT={model:'gpt-future-manual',displayName:'Future GPT',provider:'codex',available:true,supportedReasoningEfforts:efforts(['low','high'])};
const futureGemini={model:'gemini-future-flash',displayName:'Future Gemini Flash',provider:'gemini',available:true,supportedReasoningEfforts:efforts(['low','high'])};
const filteredRows=[
 {model:'gpt-hidden-fixture',displayName:'Hidden GPT',provider:'codex',hidden:true,supportedReasoningEfforts:[]},
 {model:'gpt-unavailable-fixture',displayName:'Unavailable GPT',provider:'codex',available:false,supportedReasoningEfforts:[]},
 {model:'claude-fable-5-5',displayName:'Fable 5.5',provider:'claude',available:true,supportedReasoningEfforts:efforts(['low'])},
];
const state={threadId:null,workspace:root,status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',provider:'codex',model:'gpt-6.1-sol',capabilities:{},conversationActivity:[]};
const apiPosts=[],viewports=[[1440,1000,'desktop'],[390,844,'mobile']];let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.K_UI_CHROMIUM?{executablePath:process.env.K_UI_CHROMIUM}:{channel:'msedge'})});
 for(const [width,height,label]of viewports){
  let catalog=baseModels;
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(state=>{window.EventSource=class{constructor(){window.testState=next=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:next})});setTimeout(()=>window.testState(state),0);}close(){}};},state);
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());let body={};
   if(request.method()==='POST'){
    const data=request.postDataJSON();apiPosts.push({viewport:label,path:url.pathname,data});
    body=url.pathname==='/api/open'?{threadId:`worker-model-${label}`,model:data.model,provider:'codex',status:'ready',busy:false,messages:[],workers:[],workerDetails:[],capabilities:{}}:{ok:true};
   }else body=url.pathname==='/api/state'?state:
    url.pathname==='/api/projects'?{projects:[{path:root,name:'合成工作區'}]}:
    url.pathname==='/api/sessions'?{sessions:[]}:
    url.pathname==='/api/models'?{models:catalog,claudeGateway:true,geminiGateway:true}:
    url.pathname==='/api/codex/auth'?{available:true,auth:{loggedIn:true,authMethod:'chatgpt'},login:{status:'idle'}}:
    url.pathname==='/api/claude/auth'?{available:true,auth:{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'},login:{status:'idle'}}:
    url.pathname==='/api/gemini/auth'?{available:true,installed:true,auth:{loggedIn:true}}:
    url.pathname==='/api/gemini/accounts'?{enabled:false,activeAccountId:null,busy:false,loginPending:false,accounts:[]}:{ok:true};
   await route.fulfill({json:body});
  });
  await page.goto('http://127.0.0.1:5208');if(await page.getByRole('button',{name:'新對話',exact:true}).count()===0)await page.getByRole('button',{name:'展開側欄'}).click();await page.getByRole('button',{name:'新對話',exact:true}).click();
  const provider=page.getByRole('group',{name:'選擇主代理提供者',exact:true}),workerDetails=page.locator('.worker-settings');await workerDetails.locator('summary').click();
  const picker=page.getByLabel('子代理模型',{exact:true}),effortPicker=page.getByLabel('子代理推理程度',{exact:true});
  const options=()=>picker.evaluate(select=>Array.from(select.options).map(option=>({value:option.value,label:option.textContent.trim(),group:option.parentElement.label||''})));
  let rows=await options();assert.equal(rows.length,22,'21 native worker models plus AI Auto');assert.equal(rows[0].value,'auto');
  assert.deepEqual(['GPT','Claude','Gemini'].map(group=>rows.filter(row=>row.group===group).length),[7,10,4]);
  await page.screenshot({path:path.join(out,`${label}-native-catalog.png`)});

  // Simulate a live native catalog growing after a provider refresh; only supported visible rows appear.
  const accountDetails=page.locator('.provider-auth-status');if(await accountDetails.getAttribute('open')===null)await accountDetails.locator('summary').click();catalog=[...baseModels,futureGPT,futureGemini,...filteredRows];
  await page.locator('.provider-auth-row').first().getByRole('button',{name:'刷新狀態'}).click();
  await picker.locator('option[value="gpt-future-manual"]').waitFor({state:'attached'});await picker.locator('option[value="gemini-future-flash"]').waitFor({state:'attached'});
  rows=await options();assert.equal(rows.length,24,'two new native models are added to the 21 base models and Auto');
  for(const excluded of ['gpt-hidden-fixture','gpt-unavailable-fixture','claude-fable-5-5'])assert.equal(rows.some(row=>row.value===excluded),false,`${excluded} must be excluded`);

  for(const model of ['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5']){
   await picker.selectOption(model);const effortValues=await effortPicker.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));
   assert.deepEqual(effortValues,['low','medium','high','xhigh','max'],`${model} exposes all native efforts`);
   await effortPicker.selectOption('max');assert.equal(await effortPicker.inputValue(),'max');
  }
  await picker.selectOption('claude-haiku-4-5-20251001');
  assert.equal(await effortPicker.inputValue(),'');assert.equal(await effortPicker.isDisabled(),true);
  assert.doesNotMatch(await workerDetails.locator('summary').innerText(),/null/i,'native-default summary does not print null');
  await picker.selectOption('gemini-3.1-pro');
  assert.deepEqual(new Set(await effortPicker.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value))),new Set(['low','high']),'Gemini 3.1 Pro only offers low/high');
  await effortPicker.selectOption('low');

  await provider.getByRole('button',{name:'Gemini',exact:true}).click();
  assert.equal(await page.locator('.worker-settings').count(),0,'Gemini main-agent flow does not offer child-worker settings');
  await provider.getByRole('button',{name:'GPT',exact:true}).click();if(await workerDetails.getAttribute('open')===null)await workerDetails.locator('summary').click();
  await picker.selectOption('gpt-future-manual');assert.equal(await picker.inputValue(),'gpt-future-manual');
  catalog=[...baseModels,...filteredRows];await page.locator('.provider-auth-row').first().getByRole('button',{name:'刷新狀態'}).click();
  await picker.locator('option[value="gpt-future-manual"]').waitFor({state:'attached'});
  assert.equal(await picker.inputValue(),'gpt-future-manual','manual model is retained when absent from a refreshed catalog');
  await page.getByRole('alert').filter({hasText:'指定子代理目前不可用'}).waitFor();
  const create=page.getByRole('button',{name:'建立對話',exact:true});assert.equal(await create.isDisabled(),true,'unavailable manual choice blocks creation without substitution');
  assert.doesNotMatch(await picker.locator('option:checked').textContent(),/AI 自動選擇/);

  await picker.selectOption('claude-haiku-4-5-20251001');assert.equal(await effortPicker.inputValue(),'');
  await create.click();await page.getByRole('button',{name:'建立對話',exact:true}).waitFor({state:'detached'});
  const opened=apiPosts.find(item=>item.viewport===label&&item.path==='/api/open');assert(opened,'create should issue exactly one fake open request');
  assert.equal(opened.data.workerPolicy.model,'claude-haiku-4-5-20251001');assert.equal(opened.data.workerPolicy.effort,null,'native no-effort model submits JSON null');
  assert.equal(JSON.stringify(opened.data.workerPolicy).includes('"null"'),false);assert.equal(apiPosts.filter(item=>item.viewport===label&&item.path==='/api/open').length,1);
  assert.deepEqual(errors,[]);await page.close();
 }
 const result={passed:true,syntheticCatalogs:true,modelsPerCore:{gpt:7,claude:10,gemini:4},baseChoices:21,baseChoicesIncludingAuto:22,futureAdded:2,excluded:['hidden','unavailable','Fable'],checks:['provider grouping and AI Auto first','native efforts for three Claude 5.5 models','dated Haiku 4.5 null effort summary and submit','Gemini 3.1 Pro low/high only','future catalog models appear','hidden/unavailable/Fable stay out','manual missing choice preserved and blocks creation','Gemini main hides worker settings','desktop/mobile']};
 await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
