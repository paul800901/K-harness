// Built UI, fake subscription APIs, disposable headless browser. No real login.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';

const output=process.env.K_LOGIN_PROBE_OUTPUT??path.resolve('.runtime/subscription-settings-probe');
await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5193,strictPort:true}});
const state={threadId:null,workspace:process.cwd(),status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',provider:'codex',capabilities:{},conversationActivity:[]};
let browser,codexLoggedIn=false,claudeLoggedIn=false,codexLogin={status:'idle'},claudeLogin={status:'idle'};
const requests=[],errors=[];
const auth=provider=>provider==='codex'?{available:codexLoggedIn,auth:{loggedIn:codexLoggedIn,authMethod:codexLoggedIn?'chatgpt':null,planType:codexLoggedIn?'plus':null},login:codexLogin}:{available:claudeLoggedIn,version:'2.1.287',auth:{loggedIn:claudeLoggedIn,authMethod:claudeLoggedIn?'claude.ai':null,apiProvider:'firstParty',subscriptionType:claudeLoggedIn?'pro':null},login:claudeLogin};
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  const data=request.method()==='POST'?request.postDataJSON():undefined;
  if(request.method()==='POST')requests.push({path:url.pathname,data});
  let body={};
  if(url.pathname==='/api/state')body=state;
  else if(url.pathname==='/api/projects')body={projects:[{path:process.cwd(),name:'假工作區'}]};
  else if(url.pathname==='/api/sessions')body={sessions:[]};
  else if(url.pathname==='/api/models')body={models:[]};
  else if(url.pathname==='/api/codex/auth')body=auth('codex');
  else if(url.pathname==='/api/claude/auth')body=auth('claude');
  else if(url.pathname==='/api/codex/login/cancel'){codexLogin={status:'idle'};body=auth('codex');}
  else if(url.pathname==='/api/codex/login'){codexLogin={status:'running',url:'https://auth.openai.com/oauth/authorize?state=fixture-codex'};body=auth('codex');}
  else if(url.pathname==='/api/claude/login/cancel'){claudeLogin={status:'idle'};body={login:claudeLogin};}
  else if(url.pathname==='/api/claude/login/code'){assert.equal(data.code,'FAKE-CODE#fixture-claude');claudeLogin={...claudeLogin,codeSubmitted:true};body={login:claudeLogin};}
  else if(url.pathname==='/api/claude/login'){
   if(request.method()==='POST')claudeLogin={status:'running',url:'https://claude.ai/oauth/authorize?state=fixture-claude'};
   body={login:claudeLogin};
  }
  await route.fulfill({json:body});
 });
 await page.goto('http://127.0.0.1:5193');
 await page.getByRole('button',{name:'設定',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'設定',exact:true});
 await settings.getByRole('button',{name:'登入 GPT / Codex',exact:true}).waitFor();
 await settings.getByRole('button',{name:'登入 Claude 訂閱',exact:true}).waitFor();
 assert.equal(await settings.getByRole('button',{name:'建立對話',exact:true}).count(),0);
 await page.screenshot({path:path.join(output,'signed-out-settings.png')});

 await settings.getByRole('button',{name:'登入 GPT / Codex',exact:true}).click();
 await settings.getByRole('link',{name:'開啟官方登入頁',exact:true}).waitFor();
 assert.equal(await settings.getByRole('link',{name:'開啟官方登入頁',exact:true}).getAttribute('href'),codexLogin.url);
 await settings.getByRole('button',{name:'停止登入',exact:true}).click();
 await settings.getByRole('button',{name:'登入 GPT / Codex',exact:true}).waitFor();
 await settings.getByRole('button',{name:'登入 GPT / Codex',exact:true}).click();
 codexLoggedIn=true;codexLogin={status:'complete'};
 await page.waitForFunction(()=>document.querySelector('summary[aria-label="帳號連線"]')?.textContent.includes('GPT 已連線'));
 assert.equal(await settings.getByRole('button',{name:'登入 GPT / Codex',exact:true}).isDisabled(),true);

 await settings.getByRole('button',{name:'登入 Claude 訂閱',exact:true}).click();
 await settings.getByLabel('Claude 官方授權碼',{exact:true}).waitFor();
 assert.equal(await settings.getByRole('link',{name:'開啟官方登入頁',exact:true}).getAttribute('href'),claudeLogin.url);
 await settings.getByRole('button',{name:'停止登入',exact:true}).click();
 await settings.getByRole('button',{name:'登入 Claude 訂閱',exact:true}).waitFor();
 await settings.getByRole('button',{name:'登入 Claude 訂閱',exact:true}).click();
 await settings.getByLabel('Claude 官方授權碼',{exact:true}).fill('FAKE-CODE#fixture-claude');
 await settings.getByRole('button',{name:'交付官方驗證',exact:true}).click();
 claudeLoggedIn=true;claudeLogin={status:'complete'};
 await page.waitForFunction(()=>document.querySelector('summary[aria-label="帳號連線"]')?.textContent.includes('Claude 已連線'));
 assert.equal(await settings.getByRole('button',{name:'登入 Claude 訂閱',exact:true}).isDisabled(),true);
 await page.screenshot({path:path.join(output,'connected-settings.png')});
 await settings.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:'新對話',exact:true}).click();
 const accountDetails=page.locator('details').filter({has:page.locator('summary[aria-label="帳號連線"]')});
 await page.waitForFunction(()=>document.querySelector('summary[aria-label="帳號連線"]')?.textContent.includes('Claude 已連線'));
 await accountDetails.locator('summary').click();
 for(const name of ['登入 GPT / Codex','登入 Claude 訂閱'])assert.equal(await accountDetails.getByRole('button',{name,exact:true}).isDisabled(),true);
 assert.ok(!requests.some(request=>request.path==='/api/open'));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,settingsLoginBothProviders:true,codexAutoRefresh:true,claudeCodeAndAutoRefresh:true,cancelBoth:true,sharedNewDialogue:true,noConversationCreated:true,output}));
}finally{await browser?.close();await server.httpServer.close();}
