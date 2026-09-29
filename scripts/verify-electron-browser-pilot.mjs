// Integration test of our fake page only; no model, account or production K.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=path.resolve('.runtime/electron-browser-pilot-20260926');
const executable=path.resolve('node_modules/electron/dist/electron.exe');
await access(executable);await mkdir(root,{recursive:true});
// Do not silently reuse or kill an occupied protected endpoint.
const {createServer}=await import('node:net');
const check=createServer();await new Promise((resolve,reject)=>{check.once('error',reject);check.listen(47971,'127.0.0.1',resolve);});await new Promise(resolve=>check.close(resolve));
const env={...process.env,K_ELECTRON_PILOT_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,[path.resolve('scripts/electron-browser-pilot.cjs')],{env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
const exited=once(child,'exit');
let stderr='',browser,ready;const diagnostics=[];
child.stderr.on('data',chunk=>{stderr+=chunk;});
const lines=createInterface({input:child.stdout});
const waiters=[];
const receive=data=>{diagnostics.push(data);if(data.type==='ready')ready=data;for(const item of [...waiters])if(item.type===data.type){waiters.splice(waiters.indexOf(item),1);item.resolve(data);}};
lines.on('line',line=>{try{receive(JSON.parse(line));}catch{}});child.on('message',receive);
const waitFor=type=>new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error(`Timed out waiting for ${type}`)),20000);
 waiters.push({type,resolve:value=>{clearTimeout(timer);resolve(value);}});
});
const result={scope:'fake-data-only',productionChanged:false,checks:[]};
try{
 await waitFor('started');
 browser=await chromium.connectOverCDP('http://127.0.0.1:47971',{noDefaults:true});
 const info=ready??await waitFor('ready');
 const context=browser.contexts()[0];
 const target=context.pages().find(p=>p.url()===info.origin+'/');assert(target);
 const owner=context.pages().find(p=>p.url()===info.origin+'/owner');assert(owner);
 // Explicitly record the exposure. This unfiltered context MUST NOT go to MCP.
 result.rawContextIncludesOwner=true;
 result.checks.push('WebContentsView is a real Playwright Page');
 await target.locator('#text').fill('同一個真網頁 K_FAKE_INPUT');
 assert.equal(await target.locator('#text').inputValue(),'同一個真網頁 K_FAKE_INPUT');
 result.checks.push('Direct DOM input roundtrip');
 const popupPromise=context.waitForEvent('page');await target.locator('#popup').click();
 const popup=await popupPromise;await popup.getByRole('button',{name:'完成假登入'}).click();
 await target.getByRole('button',{name:'讀回假登入'}).click();
 assert.match(await target.locator('#status').innerText(),/fake_login=ok/);
 assert.equal(await owner.evaluate(()=>document.cookie),'');
 result.checks.push('Popup fake login shares browser session but not owner session');
 await target.mouse.wheel(0,900);await target.waitForFunction(()=>scrollY>0);
 result.checks.push('Native page scroll');
 assert.equal(await target.evaluate(()=>typeof require),'undefined');
 result.checks.push('No renderer Node require');
 const captured=waitFor('capture');child.send({type:'capture'});await captured;
 result.status='pilot-passed-not-production-ready';
}catch(error){result.status='failed';result.error=error.stack;process.exitCode=1;}
finally{
 await browser?.close().catch(()=>{});
 if(child.exitCode===null&&child.connected)child.send({type:'close'});
 let shutdownTimer;
 try{await Promise.race([exited,new Promise((_,reject)=>{shutdownTimer=setTimeout(()=>reject(Error('Pilot shutdown unconfirmed')),15000);})]);}
 catch(error){result.shutdownError=error.message;process.exitCode=1;}
 finally{clearTimeout(shutdownTimer);}
 result.stderr=stderr;result.diagnostics=diagnostics;await writeFile(path.join(root,`result-${Date.now()}.json`),JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,stderr:undefined},null,2));
}
