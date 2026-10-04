// Built UI, fake sessions and uploads only. No user browser profile or real provider calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const output=path.resolve('.runtime/gemini-capabilities-20261004/ui');await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5197,strictPort:true}});
let browser;const errors=[],cases=[];
try{
 browser=await chromium.launch({executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const provider of ['gemini','codex','claude']){
  const state={threadId:'fake-'+provider,model:provider==='gemini'?'gemini-3.1-pro':'fixture-model',modelDisplayName:'Fixture',inputModalities:provider==='gemini'?['text','image','pdf','audio','video']:['text','image'],status:'ready',busy:false,messages:[],tools:[],questions:[],artifacts:[],provider,workspace:process.cwd(),conversationActivity:[],usage:{}};
  const page=await browser.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(initial=>{window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:initial})}),0);}close(){}};},state);
  let uploaded;
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());let body;
   if(url.pathname==='/api/upload'){uploaded=route.request().postDataJSON();body={id:'fake-upload',name:uploaded.name,threadId:uploaded.threadId,kind:'audio',size:8};}
   else{assert.equal(route.request().method(),'GET');body=url.pathname==='/api/state'?state:url.pathname==='/api/projects'?{projects:[]}:url.pathname==='/api/sessions'?{sessions:[]}:url.pathname==='/api/models'?{models:[]}:{}};
   await route.fulfill({json:body});
  });
  await page.goto('http://127.0.0.1:5197');await page.getByRole('button',{name:'加入檔案',exact:true}).waitFor();
  const input=page.locator('input[type=file]'),accept=await input.getAttribute('accept');assert.equal(accept.includes('.mp4'),provider==='gemini');assert.equal(accept.includes('.m4a'),provider==='gemini');
  if(provider==='gemini'){
   await input.setInputFiles({name:'fake-audio.wav',mimeType:'audio/wav',buffer:Buffer.from('fake wav')});await page.getByRole('button',{name:'移除附件 fake-audio.wav',exact:true}).waitFor();assert.equal(uploaded.threadId,state.threadId);assert.equal(uploaded.name,'fake-audio.wav');
   await page.screenshot({path:path.join(output,'gemini-audio-chip.png')});await page.getByRole('button',{name:'移除附件 fake-audio.wav',exact:true}).click();
   await page.getByRole('button',{name:'設定',exact:true}).click();await page.getByText(/原始 PDF（含掃描頁）/).waitFor();await page.getByRole('button',{name:'關閉',exact:true}).click();
  }
  cases.push({provider,accept,passed:true});await page.close();
 }
 assert.deepEqual(errors,[]);
}finally{await writeFile(path.join(output,'result.json'),JSON.stringify({cases,errors},null,2));await browser?.close();await new Promise(r=>server.httpServer.close(r));}
