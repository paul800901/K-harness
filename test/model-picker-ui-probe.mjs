// Built-UI regression using only fake API data and a separate headless browser.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {preview} from 'vite';

const root=fileURLToPath(new URL('..',import.meta.url));
const origin='http://127.0.0.1:5189';
const server=await preview({preview:{host:'127.0.0.1',port:5189,strictPort:true}});
const output=path.resolve(root,'.runtime/compact-model-picker-20260930/connection-cancel');
const models=[['gpt-6.1-sol','GPT-6.1-Sol'],['gpt-6-astra','GPT-6-Astra'],['gpt-6-sol','GPT-6-Sol'],['gpt-6-luna','GPT-6-Luna'],['gpt-future-official','Future official']].map(([model,displayName])=>({model,displayName,provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',inputModalities:['text','image']}));
models.push({model:'claude-future',displayName:'Claude Future',provider:'claude',description:'Official catalog description',supportedReasoningEfforts:[{reasoningEffort:'ultra'}]});
const state={threadId:null,workspace:root,status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',provider:'codex',capabilities:{},conversationActivity:[]};
const requests=[];
let browser,openRoute;
try{
 browser=await chromium.launch({headless:true,...(process.env.K_UI_CHROMIUM?{executablePath:process.env.K_UI_CHROMIUM}:{channel:'msedge'})});
 const page=await browser.newPage({viewport:{width:1400,height:1050}});
 await page.addInitScript(state=>{window.EventSource=class{constructor(){window.testState=next=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:next})});setTimeout(()=>window.testState(state),0);}close(){}};},state);
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='POST')requests.push({path:url.pathname,data:request.postDataJSON()});
  if(url.pathname==='/api/open'){openRoute=route;state.connectionOpening=true;await page.evaluate(s=>window.testState(s),state);return;}
  if(url.pathname==='/api/stop'){state.connectionOpening=false;await page.evaluate(s=>window.testState(s),state);await openRoute.fulfill({status:400,json:{error:'已取消連線。'}});}
  const body=url.pathname==='/api/state'?state:
   url.pathname==='/api/projects'?{projects:[{path:root,name:'假工作區'},{path:path.join(root,'different-project'),name:'另一個假工作區'}]}:
   url.pathname==='/api/sessions'?{sessions:[]}:
   url.pathname==='/api/models'?{models}:
   url.pathname==='/api/codex/auth'?{available:true,auth:{loggedIn:true,authMethod:'chatgpt'},login:{status:'idle'}}:
   url.pathname==='/api/claude/auth'?{available:true,auth:{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'},login:{status:'idle'}}:
   url.pathname==='/api/open'?{threadId:'fake-sol61'}:{};
  await route.fulfill({json:body});
 });
 await page.goto(origin);
 await page.getByRole('button',{name:'新對話',exact:true}).click();
 const provider=page.getByRole('group',{name:'選擇主代理提供者',exact:true});
 const picker=page.getByRole('button',{name:'主代理模型',exact:true});
 await picker.waitFor();assert.equal(await picker.getAttribute('aria-haspopup'),'menu');
 await picker.click();
 let menu=page.getByRole('menu',{name:'主代理模型選單',exact:true});await menu.waitFor({state:'visible'});
 await menu.getByRole('menuitemradio',{name:'GPT-6.1-Sol',exact:true}).waitFor();
 assert.equal(await menu.getByRole('menuitemradio').count(),5);
 await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
 await provider.getByRole('button',{name:'Claude',exact:true}).click();
 await picker.click();await menu.waitFor({state:'visible'});
 await menu.getByRole('menuitemradio',{name:'Claude Future',exact:true}).click();
 const effort=page.getByLabel('主代理推理程度',{exact:true});
 assert((await effort.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value))).includes('ultra'),'Claude native effort missing');
 assert.equal(await page.getByText('Official catalog description',{exact:true}).count(),0,'English catalog description should not be displayed');
 await provider.getByRole('button',{name:'GPT',exact:true}).click();
 await picker.click();await menu.waitFor({state:'visible'});
 await menu.getByRole('menuitemradio',{name:'Future official',exact:true}).click();
 await effort.selectOption('high');
 await page.getByLabel('新對話工作區',{exact:true}).selectOption(path.join(root,'different-project'));
 await mkdir(output,{recursive:true});
 await page.screenshot({path:path.join(output,'new-dialog.png'),fullPage:true});
 await page.getByRole('button',{name:'建立對話',exact:true}).click();
 await page.getByRole('button',{name:'建立對話',exact:true}).waitFor({state:'detached'});
 await page.getByRole('button',{name:'取消連線',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'取消連線',exact:true}).isEnabled(),true);
 await page.screenshot({path:path.join(output,'cancel-opening.png'),fullPage:true});
 await page.getByRole('button',{name:'取消連線',exact:true}).click();
 await page.getByRole('button',{name:'取消連線',exact:true}).waitFor({state:'detached'});
 const opened=requests.find(r=>r.path==='/api/open');
 assert.equal(opened.data.model,'gpt-future-official');assert.equal(opened.data.workspace,path.join(root,'different-project'));
 assert.equal(opened.data.effort,'high');assert.equal(opened.data.accessMode,'workspace-write');assert.deepEqual(opened.data.workerPolicy,{model:'gpt-6-luna',effort:'high'});
 assert.deepEqual(requests.filter(r=>r.path==='/api/stop').map(r=>r.data),[{cancelOpening:true}]);
 assert.equal(requests.filter(r=>r.path==='/api/open').length,1);
 const result={passed:true,checks:['native old and future models visible in compact menu','Claude provider and native effort visible','English description hidden','selected workspace sent','cancel enabled during pending open','only pending connection stopped','no retry'],openRequest:opened};
 await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
