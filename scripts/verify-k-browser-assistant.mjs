import {spawn} from 'node:child_process';
// Isolated localhost fixture only. Never attaches to daily Chrome or real accounts.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createExternalBrowserGateway} from '../src/external-browser-gateway.mjs';
import {createChromeExtensionContext} from '../src/chrome-extension-context.mjs';

const root=path.resolve('.runtime/k-browser-assistant-20260927',`probe-${Date.now()}`);
await mkdir(root,{recursive:true});
const extensionPath=path.resolve(process.env.K_PROBE_EXTENSION_PATH??'browser-extension/dist');
const manifest=JSON.parse(await readFile(path.join(extensionPath,'manifest.json'),'utf8'));
const extensionId=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
const record={scope:'new Chromium profile, localhost fake pages only; no formal K or real login',checks:[]};
let context,gateway;const browserProfile=path.join(root,'chrome-profile');
const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<title>K fake store</title><h1>Fake Store</h1><input id="name"><button id="save" onclick="localStorage.setItem(\'fake-login\',document.querySelector(\'#name\').value)">Save fake login</button><p id="status"></p>');});
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 context=await chromium.launchPersistentContext(browserProfile,{executablePath:path.resolve('.runtime/playwright-browsers/chromium-1246/chrome-win64/chrome.exe'),headless:false,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`],viewport:null});
 let worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:15000});
 assert.equal(await worker.evaluate(()=>chrome.runtime.getManifest().name),'K 瀏覽器助手');
 const setup=await context.newPage();await setup.goto(`chrome://extensions/?id=${extensionId}`);
 await setup.locator('#devMode').click({timeout:15000});
 await setup.locator('#allow-incognito').click({timeout:15000});
 record.extensionDetails=await setup.locator('extensions-detail-view').innerText();
 await setup.screenshot({path:path.join(root,'extension-details.png')});
 worker=await context.newPage();await worker.goto(`chrome-extension://${extensionId}/status.html`);
 assert.equal(await worker.evaluate(()=>chrome.extension.isAllowedIncognitoAccess()),true);
 await setup.close();
 const normal=await context.newPage();await normal.goto(origin);await normal.locator('#name').fill('FAKE_REGULAR');await normal.locator('#save').click();
 const privateWindow=await worker.evaluate(url=>chrome.windows.create({url,incognito:true}),origin);
 record.checks.push('K-branded extension loaded; incognito allowed only in disposable test profile');
 for(const name of ['output','owner-profile'])await mkdir(path.join(root,name));
 gateway=await createExternalBrowserGateway({directory:path.join(root,'output'),profile:path.join(root,'owner-profile'),launchExternalContext:({mode})=>createChromeExtensionContext({mode,extensionId,timeoutMs:30000,openConnectPage:async url=>{
  const child=spawn(path.resolve('.runtime/playwright-browsers/chromium-1246/chrome-win64/chrome.exe'),['--user-data-dir='+browserProfile,'--profile-directory=Default',url],{windowsHide:true,stdio:'ignore'}); await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
  // No approval click: a K request must connect a fresh tab automatically.
 }})});
 const config=gateway.aiMcpServer;let id=0;
 const rpc=async(method,params)=>{const response=await fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(50000)});assert.equal(response.status,200);const text=await response.text();const message=JSON.parse(text.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5)).join('\n')||text);assert(!message.error,JSON.stringify(message));return message.result;};
 const call=async(name,args={})=>{const value=await rpc('tools/call',{name,arguments:args});assert(!value.isError,JSON.stringify(value));return value;};
 await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'K fake probe',version:'1'}});
 const list=await rpc('tools/list');assert(list.tools.some(t=>t.name==='browser_snapshot'));assert(list.tools.some(t=>t.name==='browser_session'));
 await call('browser_session',{mode:'regular'});
 await call('browser_navigate',{url:origin});
 let result=await call('browser_evaluate',{function:'() => localStorage.getItem("fake-login")'});assert(JSON.stringify(result).includes('FAKE_REGULAR'));
 await gateway.humanRequest('/action',{type:'takeover'});assert.equal((await rpc('tools/call',{name:'browser_snapshot',arguments:{}})).isError,true);await gateway.humanRequest('/action',{type:'release'});
 record.checks.push('regular mode preserves fake login; human takeover blocks AI tools');
 await call('browser_session',{mode:'incognito'});
 await call('browser_navigate',{url:origin});
 await call('browser_take_screenshot');
 result=await call('browser_evaluate',{function:'() => ({value:localStorage.getItem("fake-login"),title:document.title})'});assert(!JSON.stringify(result).includes('FAKE_REGULAR'));assert(JSON.stringify(result).includes('K fake store'));
 await call('browser_tabs',{action:'new'});await call('browser_navigate',{url:origin});
 const state=await gateway.getState();assert.equal(state.browserMode,'incognito');
 const groups=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({});return tabs.filter(x=>x.url?.startsWith('http://127.0.0.1:')).map(x=>({incognito:x.incognito,url:x.url,windowId:x.windowId}));});
 record.groupTabs=groups;
 assert.equal(groups.filter(x=>x.incognito&&x.url.startsWith(origin)).length,3);
 assert.equal(groups.filter(x=>!x.incognito&&x.url.startsWith(origin)).length,2);
 record.checks.push('incognito starts without regular fake login; new tab and navigation via MCP succeed');
 await call('browser_session',{mode:'regular'});result=await call('browser_evaluate',{function:'() => localStorage.getItem("fake-login")'});assert(JSON.stringify(result).includes('FAKE_REGULAR'));
 record.checks.push('switch back preserves regular session');
 await gateway.close();gateway=null;
 assert.equal(normal.isClosed(),false);assert.equal(await normal.locator('h1').innerText(),'Fake Store');
 assert((await worker.evaluate(()=>chrome.tabs.query({}))).some(tab=>tab.incognito));
 record.checks.push('closing K connection leaves user normal and incognito tabs open');record.status='fake integration passed';
}catch(error){record.status='failed';record.error=error.stack;process.exitCode=1;}
finally{await gateway?.close().catch(()=>{});await context?.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));await writeFile(path.join(root,'result.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({root,...record},null,2));}



