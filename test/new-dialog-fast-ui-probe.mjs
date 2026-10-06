// Built UI only. All APIs are intercepted; no real conversation or provider turn.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';

const root=process.cwd(),out=path.resolve('.runtime/new-dialog-fast-20261007/ui');
await mkdir(out,{recursive:true});
const models=[
 {model:'gpt-6-astra',displayName:'GPT-6 Astra',provider:'codex',isDefault:true,serviceTiers:[{id:'catalog-fast',name:'Fast'}]},
 {model:'gpt-6-luna',displayName:'GPT-6 Luna',provider:'codex',serviceTiers:[{id:'catalog-fast',name:'Fast'}]},
 {model:'gpt-5.6-terra',displayName:'GPT-5.6 Terra',provider:'codex'},
 {model:'claude-opus-5-5',displayName:'Claude Opus 5.5',provider:'claude'},
 {model:'gemini-3.8-flash',displayName:'Gemini 3.8 Flash',provider:'gemini'},
].map(m=>({...m,defaultReasoningEffort:'low',supportedReasoningEfforts:['low','high'].map(reasoningEffort=>({reasoningEffort}))}));
const server=await preview({preview:{host:'127.0.0.1',port:5202,strictPort:true}}),results=[],errors=[];
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const [width,height,scale,remote] of [[1440,1000,100,false],[1100,760,125,false],[390,844,100,true],[360,640,100,true]]){
  const page=await browser.newPage({viewport:{width,height}}),posts=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  let current={threadId:null,workspace:root,status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',provider:'codex',capabilities:{},conversationActivity:[]};
  await page.addInitScript(({initial,scale})=>{
   localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));
   window.EventSource=class{constructor(){window.testState=state=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state})});setTimeout(()=>{this.onopen?.();window.testState(initial);},0);}close(){}};
  },{initial:current,scale});
  // Set remote flag before modules execute, matching the remote server's HTML.
  if(remote)await page.route('http://127.0.0.1:5202/',async route=>{const res=await route.fetch();await route.fulfill({response:res,body:(await res.text()).replace('<html','<html data-k-remote="true"')});});
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.method()==='POST'){
    assert.equal(url.pathname,'/api/open','no login, model-change, quota, or work mutations allowed');
    const data=request.postDataJSON();posts.push(data);
    const model=models.find(m=>m.model===data.model);
    current={...current,threadId:'fixture-room',model:data.model,provider:model.provider,effort:data.effort??model.defaultReasoningEffort,efforts:['low','high'],fastTier:model.serviceTiers?.[0],serviceTier:data.serviceTier??'default',effectiveServiceTier:data.serviceTier??'default',accessMode:data.accessMode,status:'ready'};
    await route.fulfill({json:{threadId:current.threadId}});await page.evaluate(s=>window.testState(s),current);return;
   }
   const auth=url.pathname==='/api/claude/auth'?{available:true,auth:{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'},login:{status:'idle'}}:{available:true,installed:true,auth:{loggedIn:true,status:'authenticated',authMethod:'chatgpt'},login:{status:'idle'}};
   const body=url.pathname==='/api/state'?current:url.pathname==='/api/models'?{models}:url.pathname==='/api/projects'?{projects:[{path:root,name:'假工作區'}]}:url.pathname==='/api/sessions'?{sessions:[]}:url.pathname.endsWith('/auth')?auth:{};
   await route.fulfill({json:body});
  });
  await page.goto('http://127.0.0.1:5202/');
  const open=async()=>{
   const button=page.getByRole('button',{name:'新對話',exact:true});
   if(!await button.isVisible())await page.getByRole('button',{name:'展開側欄',exact:true}).click();
   await button.click();await page.getByRole('button',{name:'主代理模型',exact:true}).waitFor();
  };
  const modal=page.locator('dialog:has(.model-picker)'),trigger=modal.getByRole('button',{name:'推理程度與速度',exact:true}),speed=modal.getByRole('switch',{name:'原生加速'}),effort=modal.getByLabel('主代理推理程度',{exact:true});
  const choose=async name=>{await modal.getByRole('button',{name:'主代理模型',exact:true}).click();await modal.getByRole('menuitemradio',{name,exact:true}).click();};
  const submit=async()=>{await modal.getByRole('button',{name:'建立對話',exact:true}).click();await modal.waitFor({state:'hidden'});};
  await open();assert.equal(await speed.isVisible(),false);await trigger.click();assert.equal(await speed.isChecked(),false);assert.equal(posts.length,0);
  await effort.selectOption('high');await trigger.click();await speed.check();
  assert.match(await trigger.textContent(),/高.*加速/);assert.match(await modal.locator('.reasoning-popover').textContent(),/會消耗更多額度.*第一則訊息/s);
  assert.equal(await modal.locator('.reasoning-tier-pending').count(),0);
  await page.screenshot({path:path.join(out,`${width}-${scale}-open.png`),fullPage:true});
  const box=await modal.locator('.reasoning-popover').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,'popover stays within viewport');
  assert.equal(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'new dialog does not overflow horizontally');
  await page.keyboard.press('Escape');await speed.waitFor({state:'hidden'});assert.equal(await modal.isVisible(),true,'Escape closes popup, not the new dialog');
  // Switching between two Fast-capable models must also require fresh opt-in.
  await choose('GPT-6 Luna');await trigger.click();assert.equal(await speed.isChecked(),false);await speed.check();await page.keyboard.press('Escape');
  await choose('GPT-5.6 Terra');assert.equal(await trigger.count(),0);assert.equal(await speed.count(),0);assert.equal(await effort.isVisible(),true);
  await choose('GPT-6 Astra');await trigger.click();assert.equal(await speed.isChecked(),false);await effort.selectOption('high');await trigger.click();await speed.check();await page.keyboard.press('Escape');
  assert.equal(posts.length,0);await submit();
  assert.equal(posts[0].serviceTier,'catalog-fast','uses official catalog id, not hardcoded priority');assert.equal(posts[0].effort,'high');assert.equal(posts[0].accessMode,'workspace-write');assert.equal(posts[0].permissionConfirmed,false);assert.equal(posts[0].workerPolicy.model,'auto');
  // Existing accelerated room must not become the next room's default.
  await open();await trigger.click();assert.equal(await speed.isChecked(),false);await effort.selectOption('high');await trigger.click();await effort.selectOption('');await submit();
  assert.equal(posts[1].serviceTier,'default');assert.equal(posts[1].effort,'low','empty effort maps to native model default, not empty string');
  // Other providers neither display nor receive Codex serviceTier.
  for(const provider of ['Claude','Gemini']){
   await open();await modal.getByRole('group',{name:'選擇主代理提供者'}).getByRole('button',{name:provider,exact:true}).click();
   assert.equal(await trigger.count(),0);assert.equal(await speed.count(),0);await effort.selectOption('high');await submit();
   assert.equal(Object.hasOwn(posts.at(-1),'serviceTier'),false);assert.equal(posts.at(-1).effort,'high');assert.equal(posts.at(-1).permissionConfirmed,false);
   assert.equal(posts.at(-1).accessMode,provider==='Claude'?'claude-manual':'workspace-write');
  }
  assert.equal(posts.length,4);results.push({width,height,scale,remote,passed:true,posts});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({passed:true,viewports:results.length}));
}finally{for(const context of browser?.contexts()??[])for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser?.close();await new Promise(r=>server.httpServer.close(r));}
