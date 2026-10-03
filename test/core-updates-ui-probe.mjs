// Real built UI, intercepted update/auth APIs, fresh headless browser profile.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const output=path.resolve('.runtime/console-flash-20261004/ui');await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5198,strictPort:true}});
const state={threadId:null,workspace:process.cwd(),status:'idle',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',provider:'codex',capabilities:{},conversationActivity:[]};
const requests=[],errors=[];let browser,release;
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());let body={};
  if(url.pathname==='/api/core-update'){
   requests.push(request.postDataJSON());
   if(requests.length===1)await new Promise(resolve=>{release=resolve;});
   if(requests.length===3)return route.fulfill({status:502,json:{error:'官方下載失敗，原核心保持不變。'}});
   body={message:requests.length===1?'Claude Code 2.1.288 已準備好；離開並停止 K 後，重新開啟即生效。':'Codex 目前為 0.160.0，沒有較新的正式版本。'};
  }else if(url.pathname==='/api/state')body=state;
  else if(url.pathname==='/api/projects')body={projects:[]};
  else if(url.pathname==='/api/sessions')body={sessions:[]};
  else if(url.pathname==='/api/models')body={models:[]};
  else if(url.pathname==='/api/gemini/accounts')body={enabled:true,accounts:[]};
  else if(url.pathname.endsWith('/auth'))body={available:true,auth:{loggedIn:true},login:{status:'idle'}};
  await route.fulfill({json:body});
 });
 await page.goto('http://127.0.0.1:5198');await page.getByRole('button',{name:'設定',exact:true}).click();
 const section=page.locator('.core-updates');await section.waitFor();assert.equal(requests.length,0);
 assert.deepEqual(await section.getByRole('button').allTextContents(),['更新 Claude Code','更新 Codex','更新 Antigravity']);
 await section.getByRole('button',{name:'更新 Claude Code',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.core-updates button:disabled').length===3);release();
 await section.getByText(/2.1.288 已準備好/).waitFor();
 await section.getByRole('button',{name:'更新 Codex',exact:true}).click();await section.getByText(/沒有較新的正式版本/).waitFor();
 await section.getByRole('button',{name:'更新 Antigravity',exact:true}).click();await section.getByText(/官方下載失敗/).waitFor();
 assert.deepEqual(requests.map(x=>x.provider),['claude','codex','gemini']);
 await section.screenshot({path:path.join(output,'buttons.png')});
 await page.setViewportSize({width:600,height:800});assert.ok(await section.evaluate(e=>e.scrollWidth<=e.clientWidth));
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,requests,noBackgroundUpdate:true,noRealUpdate:true,errors},null,2));
 console.log('Manual core update UI: PASS (3 clicks, busy, current version, error, narrow layout)');
}finally{await browser?.close();await server.httpServer.close();}
