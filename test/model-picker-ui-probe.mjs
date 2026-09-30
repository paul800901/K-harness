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
const output=path.resolve(root,'.runtime/r3/model-cancel-ui');
const models=[['gpt-6.1-sol','GPT-6.1-Sol'],['gpt-6-astra','GPT-6-Astra'],['gpt-6-sol','GPT-6-Sol'],['gpt-6-luna','GPT-6-Luna'],['gpt-future-official','Future official']].map(([model,displayName])=>({model,displayName,provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',inputModalities:['text','image']}));
models.push({model:'claude-future',displayName:'Claude Future',provider:'claude',description:'Official catalog description',supportedReasoningEfforts:[{reasoningEffort:'ultra'}]});
const state={threadId:null,workspace:root,status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',provider:'codex',capabilities:{},conversationActivity:[]};
const requests=[];
let browser,openRoute;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_UI_CHROMIUM});
 const page=await browser.newPage({viewport:{width:1400,height:1050}});
 await page.addInitScript(state=>{window.EventSource=class{constructor(){window.testState=next=>this.onmessage?.({data:JSON.stringify(next)});setTimeout(()=>window.testState(state),0);}close(){}};},state);
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
 const picker=page.getByRole('group',{name:'選擇主代理模型',exact:true});
 await picker.getByRole('button',{name:/GPT-6.1-Sol/}).waitFor();
 assert.equal(await picker.getByRole('button',{name:/GPT-6-Sol/}).count(),1);
 assert.equal(await picker.getByRole('button').count(),5);
 await page.getByRole('group',{name:'選擇主代理提供者'}).getByRole('button',{name:'Claude',exact:true}).click();
 await picker.getByRole('button',{name:/Claude Future/}).click();
 await page.getByRole('group',{name:'選擇主代理推理程度'}).getByRole('button',{name:'超高（Ultra）',exact:true}).waitFor();
 assert.equal(await page.getByText('Official catalog description',{exact:true}).count(),1);
 await page.getByRole('group',{name:'選擇主代理提供者'}).getByRole('button',{name:'GPT',exact:true}).click();
 await picker.getByRole('button',{name:/Future official/}).click();
 await page.getByRole('group',{name:'選擇主代理推理程度',exact:true}).getByRole('button',{name:'高',exact:true}).click();
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
 assert.equal(opened.data.effort,'high');assert.equal(opened.data.accessMode,'workspace-write');assert.deepEqual(opened.data.workerPolicy,{model:'gpt-6-luna'});
 assert.deepEqual(requests.filter(r=>r.path==='/api/stop').map(r=>r.data),[{cancelOpening:true}]);
 assert.equal(requests.filter(r=>r.path==='/api/open').length,1);
 const result={passed:true,checks:['native old and future models visible','Claude provider and native effort visible','native description retained','selected workspace sent','cancel enabled during pending open','only pending connection stopped','no retry'],openRequest:opened};
 await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
