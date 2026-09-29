// Disposable profile and fabricated pages only; never uses formal K or daily Chrome.
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createExternalBrowserGateway} from '../src/external-browser-gateway.mjs';
import {createChromeExtensionContext} from '../src/chrome-extension-context.mjs';

const root=path.resolve('.runtime/browser-data-navigation',String(Date.now()));await mkdir(root,{recursive:true});
const extension=path.resolve('browser-extension/dist');
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json')));
const id=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const evidence={scope:'disposable Chromium profile; fake data URLs, no account login',checks:[]};
let shell,gateway;
const deadline=setTimeout(()=>{console.error('Fixture deadline exceeded');process.exitCode=1;void shell?.close();},90000);
try{
 shell=await chromium.launchPersistentContext(path.join(root,'chrome'),{executablePath:path.resolve('.runtime/playwright-browsers/chromium-1246/chrome-win64/chrome.exe'),headless:false,timeout:20000,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const setup=await shell.newPage();await setup.goto(`chrome://extensions/?id=${id}`);
 await setup.locator('#devMode').click();await setup.locator('#allow-incognito').click();await setup.close();
 for(const directory of ['output','profiles'])await mkdir(path.join(root,directory));
 const contexts=new Map();
 gateway=await createExternalBrowserGateway({directory:path.join(root,'output'),profile:path.join(root,'profiles'),launchExternalContext:async({mode})=>{
  const ctx=await createChromeExtensionContext({mode,extensionId:id,timeoutMs:15000,openConnectPage:async url=>{const p=await shell.newPage();await p.goto(url);}});
  contexts.set(mode,ctx);return ctx;
 }});
 let seq=0;const config=gateway.aiMcpServer;
 const rpc=async(method,params)=>{
  console.log('START',method,params?.name??'');
  const response=await fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params}),signal:AbortSignal.timeout(25000)});
  const raw=await response.text();const result=JSON.parse(raw.split(/\r?\n/u).filter(l=>l.startsWith('data:')).map(l=>l.slice(5)).join('\n')||raw);
  console.log('END',method,params?.name??'');assert(!result.error,JSON.stringify(result));assert(!result.result?.isError,JSON.stringify(result));return result.result;
 };
 const call=(name,args={})=>rpc('tools/call',{name,arguments:args});
 await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'K data regression',version:'1'}});await rpc('tools/list');
 for(const mode of ['regular','incognito']){
  await call('browser_session',{mode});const ctx=contexts.get(mode),old=ctx.pages()[0],oldUrl=old.url();
  for(const encoding of ['percent','base64']){
   const html=`<!doctype html><meta charset="utf-8"><title>K ${mode} ${encoding}</title><h1>資料頁測試</h1><input id="input"><button id="button" onclick="document.querySelector('output').textContent=document.querySelector('input').value">確認</button><output></output>`;
   const url=encoding==='base64'?'data:text/html;charset=utf-8;base64,'+Buffer.from(html).toString('base64'):'data:text/html;charset=utf-8,'+encodeURIComponent(html);
   const result=await call('browser_navigate',{url});assert.match(JSON.stringify(result),/new tab/);
   const page=ctx.pages().at(-1);assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>self.origin),'null');assert.equal(old.url(),oldUrl);
   await call('browser_type',{target:'#input',text:'假資料成功'});await call('browser_click',{target:'#button'});
   const read=await call('browser_evaluate',{function:'() => ({title:document.title,text:document.querySelector("output").textContent,url:location.href,origin:self.origin})'});
   assert.match(JSON.stringify(read),/假資料成功/);assert.match(JSON.stringify(read),new RegExp(`K ${mode} ${encoding}`));
   const screenshot=await call('browser_take_screenshot');const img=screenshot.content.find(i=>i.type==='image');assert(img,'Screenshot must return an image');
   await writeFile(path.join(root,`${mode}-${encoding}.png`),Buffer.from(img.data,'base64'));
   // Reload remains a true data document rather than setContent under another origin.
   await page.reload({waitUntil:'domcontentloaded',timeout:5000});assert.equal(page.url(),url);
   evidence.checks.push({mode,encoding,title:await page.title(),opaqueOrigin:true,originalTabUnchanged:true,inputClickReadScreenshot:true,reload:true});
  }
 }
 evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=error.stack;process.exitCode=1;console.error(error);}
finally{await writeFile(path.join(root,'result.json'),JSON.stringify(evidence,null,2));await shell?.close().catch(()=>{});await gateway?.close().catch(()=>{});clearTimeout(deadline);console.log(JSON.stringify({root,...evidence},null,2));}

