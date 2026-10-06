// Built React + real HTTP/SSE + HTTPS proxy. Synthetic identity and controllers,
// NOT real Tailscale, Android keyboard, or a native provider acceptance test.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {startDesktop} from '../src/desktop-server.mjs';
import {remoteKeyHash} from '../src/remote-access.mjs';

const out=path.resolve('.runtime/mobile-remote');await mkdir(out,{recursive:true});
const root=await mkdtemp(path.join(out,'ui-')),key=randomBytes(32).toString('hex'),remotePort=54832,httpsPort=54833,origin=`https://paulus.mobile.test.ts.net:${httpsPort}`;
await mkdir(path.join(root,'.local'));await writeFile(path.join(root,'.local/remote-access.json'),JSON.stringify({origin,login:'test-owner@example.invalid',keyHash:remoteKeyHash(key),port:remotePort}));
const models=[['gpt-6-luna','GPT-6 Luna','codex'],['claude-opus-5-5','Claude Opus 5.5','claude'],['gemini-3.8-flash','Gemini 3.8 Flash','gemini']].map(([model,displayName,provider])=>({model,displayName,provider,available:true,inputModalities:['text'],supportedReasoningEfforts:[{reasoningEffort:'low'}],defaultReasoningEffort:'low'}));
const rooms=new Map(),uploads=new Map(),calls=[],errors=[];let emit,current,id=0;
const makeRoom=model=>({threadId:`fake-room-${++id}`,title:`${model.provider} 手機測試`,workspace:root,model:model.model,modelDisplayName:model.displayName,provider:model.provider,accessMode:model.provider==='claude'?'claude-manual':'workspace-write',effort:'low',efforts:['low'],inputModalities:['text'],status:'ready',busy:false,messages:[],tools:[],questions:[],artifacts:[],workers:[],queuedMessages:[],notices:[],progress:{},capabilities:{goal:false,fileSearch:false},browserAccess:{enabled:false}});
for(const model of models){const room=makeRoom(model);rooms.set(room.threadId,room);current=room;}
current=rooms.values().next().value;
const controller={concurrentConversations:true,get state(){return {...current,conversationActivity:[...rooms.values()].map(r=>({threadId:r.threadId,workspace:root,busy:r.busy,status:r.status,pendingQuestions:r.questions.length}))};},
 sessions:async()=>({sessions:[...rooms.values()]}),models:async()=>({models}),usage:async()=>({}),markViewed:()=>({ok:true}),
 async open(data){calls.push({op:'open',...data});if(data.threadId)current=rooms.get(data.threadId);else{current=makeRoom(models.find(m=>m.model===data.model));rooms.set(current.threadId,current);}emit();return {threadId:current.threadId};},
 async send(data){const room=rooms.get(data.threadId);calls.push({op:'send',...data});assert(room);if(room.busy){room.queuedMessages.push({id:`queue-${calls.length}`,text:data.text,createdAt:new Date().toISOString(),status:'queued'});emit();return {queued:true};}room.messages.push({id:`user-${calls.length}`,role:'user',text:data.text,attachments:(data.attachmentIds??[]).map(id=>uploads.get(id)),createdAt:new Date().toISOString()});room.busy=true;room.status='working';emit();return {sent:true};},
 async stop(data){calls.push({op:'stop',...data});const room=rooms.get(data.threadId);room.busy=false;room.status='interrupted';emit();return {stopped:true};},
 async answer(data){calls.push({op:'answer',...data});rooms.get(data.threadId).questions=[];emit();return {answered:true};},
 async upload(data){calls.push({op:'upload',threadId:data.threadId});const file={id:`upload-${uploads.size}`,name:data.name,size:Buffer.from(data.base64,'base64').length,bytes:Buffer.from(data.base64,'base64'),contentType:'text/plain',isText:true};uploads.set(file.id,file);return {id:file.id,name:file.name,size:file.size};},
 async attachmentFile(id){return uploads.get(id);},async artifact(){return {name:'result.txt',contentType:'text/plain',isText:true,bytes:Buffer.from('REMOTE_DOWNLOAD_OK')};},async close(){},
};
const service=()=>({status:async()=>({available:true,auth:{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}}),close:async()=>{}});
const app=await startDesktop({root,port:0,controllerFactory:({onChange})=>{emit=onChange;return controller;},claudeLoginFactory:service,codexLoginFactory:service,geminiLoginFactory:service,localDictationFactory:()=>({close:async()=>{}})});
let dropNextSendResponse=false;const sendTransports=[];
const proxy=https.createServer({key:await readFile(path.join(out,'test-key.pem')),cert:await readFile(path.join(out,'test-cert.pem'))},(req,res)=>{
 if(req.url==='/api/send')sendTransports.push({command:req.headers['x-k-command']});
 const upstream=http.request({host:'127.0.0.1',port:remotePort,path:req.url,method:req.method,headers:{...req.headers,'tailscale-user-login':'test-owner@example.invalid'}},response=>{if(dropNextSendResponse&&req.url==='/api/send'){dropNextSendResponse=false;response.resume();res.destroy();return;}res.writeHead(response.statusCode,response.headers);response.pipe(res);});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});res.on('close',()=>upstream.destroy());req.pipe(upstream);
});await new Promise(r=>proxy.listen(httpsPort,'127.0.0.1',r));
let browser,context,page,desktop;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const noOverflow=async page=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal page overflow');
const screenshot=name=>page.screenshot({path:path.join(out,name+'.png')});
try{
 browser=await chromium.launch({executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--host-resolver-rules=MAP paulus.mobile.test.ts.net 127.0.0.1','--no-proxy-server']});
 context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,deviceScaleFactor:2,ignoreHTTPSErrors:true,userAgent:'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'});
 page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.getByLabel('K 存取金鑰').fill(key);await page.getByRole('button',{name:'連接 K',exact:true}).click();
 await page.getByText('電腦 K 已連線',{exact:true}).waitFor();await noOverflow(page);await screenshot('mobile-chat');
 assert.equal((await context.cookies()).find(c=>c.name==='__Host-k_remote').secure,true);
 const manifest=await page.evaluate(async()=>{const manifest=await(await fetch('/manifest.webmanifest')).json();return {manifest,icons:await Promise.all(manifest.icons.map(async icon=>{const blob=await(await fetch(icon.src)).blob();const bitmap=await createImageBitmap(blob);return [bitmap.width,bitmap.height];}))};});assert.deepEqual(manifest.icons,[[192,192],[512,512]]);
 // Back dismisses the drawer; same existing rooms, no mobile copies.
 await page.getByRole('button',{name:'展開側欄',exact:true}).click();await page.getByRole('dialog',{name:'工作區與聊天室'}).waitFor();await screenshot('mobile-drawer');await page.goBack();await page.getByRole('button',{name:'展開側欄',exact:true}).waitFor();
 desktop=await browser.newPage({viewport:{width:1440,height:1000}});await desktop.goto(app.createLaunchUrl());await desktop.getByRole('textbox',{name:'工作訊息',exact:true}).waitFor();
 // A modal opened over the mobile drawer must be dismissible with Android-style Back.
 await page.getByRole('button',{name:'展開側欄',exact:true}).click();await page.getByRole('button',{name:'新對話',exact:true}).click();await page.getByRole('dialog',{name:'新對話',exact:true}).waitFor();await page.goBack();await page.getByRole('dialog',{name:'新對話',exact:true}).waitFor({state:'hidden'});await page.getByRole('textbox',{name:'工作訊息',exact:true}).waitFor();
 const first=current.threadId;
 // Existing provider rooms open through the actual remote API, and desktop follows.
 for(const room of [...rooms.values()]){
  await page.evaluate(async room=>{const r=await fetch('/api/open',{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1','X-K-Command':crypto.randomUUID()},body:JSON.stringify({threadId:room.threadId,model:room.model})});if(!r.ok)throw Error(await r.text());},room);
  await page.getByRole('heading',{name:room.title,exact:true}).waitFor();await desktop.getByRole('heading',{name:room.title,exact:true}).waitFor();assert.equal(current.threadId,room.threadId);
 }
 // New room uses the existing picker and subscription checks (including Claude).
 for(const provider of ['GPT','Claude','Gemini']){
  await page.getByRole('button',{name:'展開側欄',exact:true}).click();await page.getByRole('button',{name:'新對話',exact:true}).click();
  await page.getByRole('button',{name:provider,exact:true}).click();await page.getByRole('button',{name:'建立對話',exact:true}).click();await page.getByRole('dialog',{name:'新對話',exact:true}).waitFor({state:'hidden'});await wait(150);assert.equal(rooms.size,provider==='GPT'?4:provider==='Claude'?5:6);await noOverflow(page);
 }
 const composer=()=>page.getByRole('textbox',{name:'工作訊息',exact:true});
 await composer().fill('中文注音測試');await composer().press('Enter');assert(!calls.some(c=>c.op==='send'),'mobile Enter must only insert a newline');await composer().fill('附件與工作');
 await page.locator('input[type=file]').setInputFiles({name:'手機附件.txt',mimeType:'text/plain',buffer:Buffer.from('MOBILE_FILE')});await page.locator('.composer-card .attachment-chip').waitFor();await page.getByRole('button',{name:'送出訊息',exact:true}).click();await page.getByRole('button',{name:'停止工作',exact:true}).waitFor();assert.equal(calls.filter(c=>c.op==='send').length,1);
 current.messages.push({id:'streaming',role:'assistant',text:'串流第一段',partial:true,createdAt:new Date().toISOString()});emit();await page.getByText('串流第一段',{exact:true}).waitFor();
 current.messages.at(-1).text+='，第二段';emit();await page.getByText('串流第一段，第二段',{exact:true}).waitFor();
 await composer().fill('待送訊息');await page.getByRole('button',{name:'送出訊息（加入待送）',exact:true}).click();await page.locator('.queued-message').waitFor();assert.equal(current.queuedMessages.length,1);await screenshot('mobile-queue');current.queuedMessages=[];emit();
 current.questions=[{id:'approval-1',kind:'approval',title:'測試核准',text:'只操作假資料',canAccept:true}];emit();await page.getByRole('button',{name:'只核准這一次',exact:true}).click();assert.equal(calls.at(-1).op,'answer');assert.equal(calls.at(-1).accept,true);
 current.questions=[{id:'approval-2',kind:'approval',title:'測試拒絕',text:'拒絕假操作',canAccept:true}];emit();await page.getByRole('button',{name:'拒絕',exact:true}).click();assert.equal(calls.at(-1).accept,false);
 current.questions=[{id:'question-1',kind:'question',questions:[{id:'answer-1',question:'選哪個？',options:['甲','乙']}]}];emit();await page.locator('.claude-question select').selectOption('甲');await page.getByRole('button',{name:'送出回答',exact:true}).click();assert.equal(calls.at(-1).answers['answer-1'],'甲');
 await page.getByRole('button',{name:'停止工作',exact:true}).click();assert.equal(current.busy,false);
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'下載附件 手機附件.txt',exact:true}).click();assert.equal((await download).suggestedFilename(),'手機附件.txt');
 current.artifacts=['result.txt'];emit();await wait(150);assert(await page.locator('.app').evaluate(el=>el.classList.contains('inspector-hidden')),'artifacts must not auto-cover mobile chat');
 await page.getByRole('button',{name:'切換工具與成果面板',exact:true}).click();await page.getByRole('dialog',{name:'成果與工作面板'}).waitFor();await screenshot('mobile-results');
 current.status='completed';current.artifacts=[...current.artifacts];emit();await wait(150);assert(!await page.locator('.app').evaluate(el=>el.classList.contains('inspector-hidden')),'status must not dismiss the open results');
 await context.setOffline(true);await context.setOffline(false);await page.getByText('電腦 K 已連線',{exact:true}).waitFor();assert(!await page.locator('.app').evaluate(el=>el.classList.contains('inspector-hidden')),'snapshot must not dismiss the open results');
 await page.locator('.mobile-backdrop').evaluate(el=>el.click());current.artifacts=[...current.artifacts];emit();await wait(150);assert(await page.locator('.app').evaluate(el=>el.classList.contains('inspector-hidden')),'backdrop close must survive snapshot/status');
 const artifact=await page.evaluate(async threadId=>{const r=await fetch(`/api/artifact?path=result.txt&threadId=${threadId}&download=1`);return r.text();},current.threadId);assert.equal(artifact,'REMOTE_DOWNLOAD_OK');
 // Work survives a closed page and a network change; only current snapshot comes back.
 await composer().fill('關頁後繼續');await page.getByRole('button',{name:'送出訊息',exact:true}).click();await page.getByRole('button',{name:'停止工作',exact:true}).waitFor();const sends=calls.filter(c=>c.op==='send').length,roomId=current.threadId;
 await page.close();assert.equal(current.busy,true);current.messages.push({id:'background-done',role:'assistant',text:'電腦已在背景完成',createdAt:new Date().toISOString()});current.busy=false;current.status='completed';emit();
 page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.getByText('電腦已在背景完成',{exact:true}).waitFor();assert.equal(current.threadId,roomId);assert.equal(calls.filter(c=>c.op==='send').length,sends);
 await context.setOffline(true);await page.getByText('電腦 K 狀態待確認',{exact:true}).waitFor();await context.setOffline(false);await page.getByText('電腦 K 已連線',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.op==='send').length,sends);
 await composer().fill('保留草稿不送出');await page.setViewportSize({width:360,height:440});await composer().focus();await noOverflow(page);const box=await composer().boundingBox();assert(box.y+box.height<=440);await screenshot('mobile-keyboard-height');
 await page.setViewportSize({width:412,height:915});await screenshot('mobile-restored');
 current.messages.push({id:'long-code',role:'assistant',text:Array.from({length:50},(_,i)=>'長回覆第 '+i+' 段').join('\n\n')+'\n\n'+String.fromCharCode(96).repeat(3)+'js\n'+('long_code_'.repeat(70))+'\n'+String.fromCharCode(96).repeat(3),createdAt:new Date().toISOString()});emit();await page.locator('.markdown pre').last().waitFor();await noOverflow(page);assert(await page.locator('.viewport').evaluate(el=>el.scrollHeight>el.clientHeight));assert(await page.locator('.markdown pre').last().evaluate(el=>el.scrollWidth>el.clientWidth));await screenshot('mobile-long-code');
 const desktopSendCount=calls.filter(c=>c.op==='send').length;await desktop.getByRole('textbox',{name:'工作訊息',exact:true}).fill('桌面沿用原本送出');await desktop.getByRole('button',{name:'送出訊息',exact:true}).click();await desktop.getByRole('button',{name:'停止工作',exact:true}).waitFor();assert.equal(calls.filter(c=>c.op==='send').length,desktopSendCount+1);await desktop.getByRole('button',{name:'停止工作',exact:true}).click();await desktop.screenshot({path:path.join(out,'desktop-regression.png')});
 // Server accepted the command but its HTTP response was lost: show unknown, never resend.
 const beforeUnknown=calls.filter(c=>c.op==='send').length;dropNextSendResponse=true;await composer().fill('伺服器已接收但回應遺失');await page.getByRole('button',{name:'送出訊息',exact:true}).click();await page.getByText('操作結果未確認；沒有自動重送。請重新連線讀回後再決定。',{exact:true}).waitFor();assert.equal(calls.filter(c=>c.op==='send').length,beforeUnknown+1);assert(current.messages.some(m=>m.text==='伺服器已接收但回應遺失'));assert.equal(sendTransports.at(-1).command,sendTransports.at(-2).command,'browser transport retry retains request ID');await screenshot('mobile-unknown-result');
 await page.reload();await page.getByText('電腦 K 已連線',{exact:true}).waitFor();await composer().fill('');await page.getByRole('button',{name:'停止工作',exact:true}).waitFor();assert.equal(calls.filter(c=>c.op==='send').length,beforeUnknown+1);await page.getByRole('button',{name:'停止工作',exact:true}).click();
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'ui-result.json'),JSON.stringify({passed:true,evidence:'real HTTPS proxy and desktop-server, synthetic Tailscale identity and native controllers',viewport:[412,915],keyboardLikeViewport:[360,440],rooms:rooms.size,mobileSendCount:sends+1,unknownAcceptedSendCount:1,sendTransports,totalSendCount:calls.filter(c=>c.op==='send').length,calls,manifest,errors},null,2));console.log(JSON.stringify({passed:true,rooms:rooms.size,sendCount:sends}));
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'ui-failure.png')});await writeFile(path.join(out,'ui-failure.json'),JSON.stringify({error:error.stack,errors,calls},null,2));throw error;}
finally{await browser?.close();proxy.closeAllConnections();await new Promise(r=>proxy.close(r));await app.close();}
