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
const output=path.resolve(root,'.runtime/r2/sol61-ui-20260930');
const models=[['gpt-6.1-sol','GPT-6.1-Sol'],['gpt-6-astra','GPT-6-Astra'],['gpt-6-sol','GPT-6-Sol'],['gpt-6-luna','GPT-6-Luna']].map(([model,displayName])=>({model,displayName,provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',inputModalities:['text','image']}));
const state={threadId:null,workspace:root,status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',provider:'codex',capabilities:{},conversationActivity:[]};
const requests=[];
let browser,offerSol=true;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_UI_CHROMIUM});
 const page=await browser.newPage({viewport:{width:1400,height:1050}});
 await page.addInitScript(state=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify(state)}),0);}close(){}};},state);
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='POST')requests.push({path:url.pathname,data:request.postDataJSON()});
  const body=url.pathname==='/api/state'?state:
   url.pathname==='/api/projects'?{projects:[{path:root,name:'假工作區'}]}:
   url.pathname==='/api/sessions'?{sessions:[]}:
   url.pathname==='/api/models'?{models:models.filter(m=>offerSol||m.model!=='gpt-6.1-sol')}:
   url.pathname==='/api/codex/auth'?{available:true,auth:{loggedIn:true,authMethod:'chatgpt'},login:{status:'idle'}}:
   url.pathname==='/api/claude/auth'?{available:false,auth:{loggedIn:false},login:{status:'idle'}}:
   url.pathname==='/api/open'?{threadId:'fake-sol61'}:{};
  await route.fulfill({json:body});
 });
 await page.goto(origin);
 await page.getByRole('button',{name:'新對話',exact:true}).click();
 const picker=page.getByRole('group',{name:'選擇主代理模型',exact:true});
 await picker.getByRole('button',{name:/GPT-6.1-Sol/}).waitFor();
 assert.equal(await picker.getByRole('button',{name:/GPT-6-Sol/}).count(),0);
 assert.equal(await picker.getByRole('button').count(),3);
 await picker.getByRole('button',{name:/GPT-6.1-Sol/}).click();
 await page.getByRole('group',{name:'選擇主代理推理程度',exact:true}).getByRole('button',{name:'高',exact:true}).click();
 await mkdir(output,{recursive:true});
 await page.screenshot({path:path.join(output,'new-dialog.png'),fullPage:true});
 await page.getByRole('button',{name:'建立對話',exact:true}).click();
 await page.getByRole('button',{name:'建立對話',exact:true}).waitFor({state:'detached'});
 const opened=requests.find(r=>r.path==='/api/open');
 assert.equal(opened.data.model,'gpt-6.1-sol');
 assert.equal(opened.data.effort,'high');
 assert.equal(opened.data.accessMode,'workspace-write');
 assert.deepEqual(opened.data.workerPolicy,{model:'gpt-6-luna'});
 offerSol=false;
 await page.getByRole('button',{name:'新對話',exact:true}).click();
 await picker.getByRole('button',{name:/GPT-6-Astra/}).waitFor();
 assert.equal(await picker.getByRole('button',{name:/Sol/}).count(),0);
 const result={passed:true,checks:['Sol 6.1 displayed','Sol 6 absent','Astra and Luna retained','native effort selection sent','native permission and Luna worker unchanged','absent native Sol 6.1 not invented'],openRequest:opened};
 await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
