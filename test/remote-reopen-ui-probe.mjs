// Real Chromium, persistent browser profile, HTTPS and K authentication; fake identity/data only.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {startDesktop} from '../src/desktop-server.mjs';
import {remoteKeyHash} from '../src/remote-access.mjs';
const base=path.resolve('.runtime/remote-reopen-20261007');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'probe-')),profile=path.join(root,'browser-profile');
const key='fake-remembered-login-key',remotePort=54848,httpsPort=54849,origin=`https://reopen.test.ts.net:${httpsPort}`;
await mkdir(path.join(root,'.local'));
await writeFile(path.join(root,'.local/remote-access.json'),JSON.stringify({origin,login:'fake-owner@example.invalid',keyHash:remoteKeyHash(key),port:remotePort}));
const posts=[],entries=[],errors=[],checks=[];
const state={threadId:null,workspace:root,status:'ready',busy:false,provider:'codex',messages:[],tools:[],questions:[],artifacts:[],workers:[],queuedMessages:[],conversationActivity:[],capabilities:{},usage:{},workerActivity:{running:0,uncertain:false,unconfirmed:0}};
const service=()=>({status:async()=>({available:false}),close:async()=>{}});
const app=await startDesktop({root,port:0,controllerFactory:()=>({state,sessions:async()=>({sessions:[]}),models:async()=>({models:[]}),usage:async()=>({}),close:async()=>{}}),claudeLoginFactory:service,codexLoginFactory:service,geminiLoginFactory:service});
assert.equal(app.remoteOrigin,origin);
const proxy=https.createServer({key:await readFile('.runtime/mobile-remote/test-key.pem'),cert:await readFile('.runtime/mobile-remote/test-cert.pem')},(req,res)=>{
 if(req.method==='POST')posts.push(req.url);
 if(req.url==='/')entries.push({cookieSent:!!req.headers.cookie});
 const upstream=http.request({host:'127.0.0.1',port:remotePort,path:req.url,method:req.method,headers:{...req.headers,'tailscale-user-login':'fake-owner@example.invalid'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});res.on('close',()=>upstream.destroy());req.pipe(upstream);
});await new Promise(resolve=>proxy.listen(httpsPort,'127.0.0.1',resolve));
const launch=()=>chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:412,height:915},ignoreHTTPSErrors:true,args:['--host-resolver-rules=MAP reopen.test.ts.net 127.0.0.1','--no-proxy-server']});
let context,page;const receipt={passed:false,synthetic:true,androidDevice:false,root};
try{
 context=await launch();page=context.pages()[0];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.getByLabel('K 存取金鑰').waitFor();
 await page.getByLabel('K 存取金鑰').fill(key);await page.getByRole('button',{name:'連接 K',exact:true}).click();await page.getByText('已連線',{exact:true}).waitFor();
 const cookie=(await context.cookies(origin)).find(c=>c.name==='__Host-k_remote');
 assert(cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Strict');assert(cookie.expires>Date.now()/1000+350*86400);
 checks.push('persistent Secure HttpOnly SameSite Strict cookie, not a browser-session cookie');
 await context.close();context=await launch();page=context.pages()[0];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.getByText('已連線',{exact:true}).waitFor();
 checks.push('complete browser-process close and reopen preserves login without another key');
 await context.route('https://outside.example.invalid/**',route=>route.fulfill({contentType:'text/html',body:`<a href="${origin}/">Open K</a>`}));
 await page.goto('https://outside.example.invalid/');const start=entries.length;
 await page.getByRole('link',{name:'Open K',exact:true}).click();
 await page.waitForURL(origin+'/');assert.equal(entries[start].cookieSent,false,'cross-site initial navigation omits Strict cookie');
 if(process.env.K_TEST_EXPECT_REOPEN==='broken'){
  await page.getByLabel('K 存取金鑰').waitFor();
  assert.equal(await page.evaluate(async()=> (await fetch('/api/sessions')).status),200,'same-origin request still has the existing valid login');
  receipt.reproduced='Login page shown despite a still-valid stored login after external navigation';
  await page.screenshot({path:path.join(root,'false-login.png')});
  await page.evaluate(()=>location.replace('/'));await page.getByText('已連線',{exact:true}).waitFor();
  checks.push('baseline false-login reproduced; same-origin scripted navigation recovers without entering the key');
 }else{
  await page.getByText('已連線',{exact:true}).waitFor();
  assert(entries.slice(start).some(e=>e.cookieSent));
  assert.equal(posts.filter(p=>p==='/api/remote/login').length,1,'reopening must not submit the key again');
  checks.push('cross-site entry recovers via a read-only same-origin check; no extra login POST or key storage');
  await page.screenshot({path:path.join(root,'recovered.png')});
 }
 const logout=await page.evaluate(async()=>(await fetch('/api/remote/logout',{method:'POST',headers:{'X-K-Request':'1','Content-Type':'application/json'},body:'{}'})).status);assert.equal(logout,200);
 await page.goto(origin);await page.getByLabel('K 存取金鑰').waitFor();assert.equal(await page.evaluate(async()=>(await fetch('/api/sessions')).status),403);
 await context.close();context=await launch();page=context.pages()[0];await page.goto(origin);await page.getByLabel('K 存取金鑰').waitFor();
 checks.push('explicit logout remains revoked across browser-process recreation');
 assert(posts.every(p=>['/api/remote/login','/api/remote/logout'].includes(p)),'no work/settings/account operations');assert.deepEqual(errors,[]);
 receipt.passed=true;receipt.checks=checks;receipt.loginPosts=posts.filter(p=>p==='/api/remote/login').length;
}catch(error){receipt.error=error.stack;throw error;}
finally{await context?.close();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await app.close();receipt.entries=entries;await writeFile(path.join(root,'result.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));}
