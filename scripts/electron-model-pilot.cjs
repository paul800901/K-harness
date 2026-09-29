'use strict';

// Candidate-only real-provider verification. This script is intentionally not
// wired into a product entry point and must be run only by its private parent.
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {startNativeOwner} = require('../src/electron-isolated-main.cjs');

const TURN_TIMEOUT_MS = 180_000;
const ALLOWED_TOOLS = new Set(['browser_navigate', 'browser_resize', 'browser_snapshot', 'browser_click']);
const runId = randomUUID();
const candidateRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeRoot = path.resolve(__dirname, '..');
const progress = (stage, extra={}) => send({type:'test-progress', stage, ...extra});
function send(message) {
  if (typeof process.send !== 'function' || !process.connected) throw Error('private-parent-required');
  process.send(message);
}

function makeFakeSite() {
  let origin;
  const server = http.createServer((req,res)=>{
    if (req.method !== 'GET' || !['/', '/fake'].includes(new URL(req.url, origin ?? 'http://127.0.0.1').pathname)) {
      res.writeHead(404).end(); return;
    }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:"});
    res.end(`<!doctype html><meta charset="utf-8"><title>K fake browser pilot</title>
      <main><p id="marker">MARKER_START</p>
      <label>Note <input id="note" aria-label="Note" autocomplete="off"></label>
      <button id="fake-login" type="button">Fake login</button><output id="cookie">fake-cookie=no</output></main>
      <script>
        const marker=document.querySelector('#marker'), note=document.querySelector('#note');
        document.querySelector('#fake-login').addEventListener('click',()=>{
          document.cookie='k_fake_login=ok; SameSite=Strict; Path=/';
          marker.textContent='FAKE_LOGIN_OK';document.querySelector('#cookie').textContent='fake-cookie=yes';
        });
        note.addEventListener('input',()=>{marker.textContent='HUMAN_NOTE:'+note.value});
      </script>`);
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',()=>{
      const address=server.address();origin=`http://127.0.0.1:${address.port}`;
      resolve({server,origin,url:`${origin}/fake`});
    });
  });
}

function toolName(value) {
  if (typeof value !== 'string') return null;
  const match=value.match(/(?:^|__)browser_(navigate|resize|snapshot|click)$/);
  return match ? `browser_${match[1]}` : null;
}
function approvalParts(question) {
  const details=question?.details;
  if (!details || typeof details !== 'object') return null;
  const codexName=question.server==='k_browser'?/run tool "([^"]+)"/.exec(question.text??'')?.[1]:null;
  const rawName=codexName ?? details.name ?? details.toolName ?? details.tool_name ?? details.tool;
  const name=toolName(rawName);
  const args=codexName?details:details.arguments ?? details.args ?? details.input ?? details.parameters;
  if (!name || !args || typeof args !== 'object' || Array.isArray(args)) return null;
  return {name,args,rawName,provider:details.provider,
    server:question.server ?? details.server ?? details.serverName ?? details.server_name};
}
function safeApproval(question, origin, currentUrl) {
  if (question?.kind !== 'approval') return null;
  const part=approvalParts(question);
  const trustedServer=part?.server==='k_browser' ||
    (part?.provider==='claude' && typeof part.rawName==='string' && /^mcp__k_browser__browser_(?:navigate|resize|snapshot|click)$/u.test(part.rawName));
  if (!part || !trustedServer || !ALLOWED_TOOLS.has(part.name)) return null;
  const {name,args}=part;
  if (name==='browser_navigate') {
    try { const url=new URL(args.url); return url.href===origin+'/fake' && !url.username && !url.password && ['http:','https:'].includes(url.protocol) ? name : null; }
    catch { return null; }
  }
  if (currentUrl!==origin+'/fake' && currentUrl!==origin+'/') return null;
  if (name==='browser_resize') return args.width===1280 && args.height===720 ? name : null;
  if (name==='browser_snapshot') return name;
  if (name==='browser_click') {
    const target=args.target ?? args.ref ?? args.selector;
    const element=args.element;
    return target==='#fake-login' || /^e\d+$/u.test(String(target)) || element==='Fake login button' || element==='Fake login' ? name : null;
  }
  return null;
}

function normalizeToolName(value) {
  if (typeof value !== 'string') return null;
  if (ALLOWED_TOOLS.has(value)) return value;
  // UI records sometimes retain the original MCP server prefix separately.
  const match=value.match(/^(?:mcp__k_browser__|k_browser[.:/])browser_(navigate|resize|snapshot|click)$/u);
  return match ? `browser_${match[1]}` : null;
}
function currentToolSummary(state, from) {
  const rows=(state.tools??[]).slice(from);
  const names=[];
  for (const row of rows) {
    if(row.name==='ToolSearch'&&typeof row.details?.query==='string'&&row.details.query.startsWith('select:')&&
      row.details.query.slice(7).split(',').every(value=>/^mcp__k_browser__browser_(navigate|resize|snapshot|click)$/u.test(value.trim())))continue;
    const name=normalizeToolName(row.name ?? row.tool ?? row.details?.name);
    if (!name) throw Error('unapproved-tool-observed');
    names.push(name);
  }
  return names;
}
function doneAssistant(state, from) {
  return [...(state.messages??[])].slice(from).reverse().find(row=>row.role==='assistant' && row.completedAt && !row.partial);
}

async function currentPageUrl(owner,state,threadId) {
  try {
    const value=await owner.services.browsers.presentation(state,threadId,null);
    return value.page && !value.page.isClosed() ? value.page.url() : '';
  } catch { return ''; }
}
async function waitForTurn(owner, controller, threadId, before, toolStart, origin, label, expectedTools, deadline) {
  const approved=new Set();
  while (Date.now()<deadline) {
    if (cancelRequested) throw Error('parent-cancelled');
    if (controller.state.threadId!==threadId) throw Error('conversation-changed');
    const state=controller.state;
    const names=currentToolSummary(state,toolStart);
    for (const question of [...(state.questions??[])]) {
      const allowed=safeApproval(question,origin,await currentPageUrl(owner,state,threadId));
      if (!allowed) {progress('unapproved-request',{kind:question.kind,server:question.server,text:question.text,details:question.details});throw Error(question.kind==='question' || question.kind==='input' ? 'unknown-question' : 'unapproved-approval');}
      if (!approved.has(question.id)) {
        approved.add(question.id);
        await controller.answer({threadId,id:question.id,accept:true});
        progress('approved-local-browser-tool',{label,tool:allowed});
      }
    }
    const final=doneAssistant(state,before);
    if (!state.busy && final) {
      const unique=new Set(names);
      if(expectedTools==='first' && ['browser_navigate','browser_resize','browser_snapshot','browser_click'].some(name=>!unique.has(name)))
        throw Error('required-first-round-browser-tools-missing');
      if(expectedTools==='snapshot' && (!names.length || names.some(name=>name!=='browser_snapshot')))
        throw Error('unexpected-second-round-tool');
      return {final,names};
    }
    if (!state.busy && !state.questions?.length && ['failed','error','uncertain','offline','interrupted'].includes(state.status))
      throw Error('model-turn-failed');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  await stopProbeTurn(controller,threadId);
  throw Error('model-turn-timeout');
}
async function stopProbeTurn(controller,threadId) {
  if (controller.state.threadId!==threadId || (!controller.state.busy && !controller.state.questions?.length)) return;
  try { await controller.stop({threadId}); } catch { /* state check below decides whether cancellation is confirmed */ }
  const end=Date.now()+20_000;
  while (Date.now()<end && controller.state.threadId===threadId && (controller.state.busy || controller.state.questions?.length))
    await new Promise(resolve=>setTimeout(resolve,200));
  if (controller.state.threadId===threadId && (controller.state.busy || controller.state.questions?.length)) throw Error('turn-stop-unconfirmed');
}

async function waitPage(owner,controller,origin) {
  const deadline=Date.now()+20_000;
  while(Date.now()<deadline) {
    const state=controller.state;
    try {
      const presentation=await owner.services.browsers.presentation(state,state.threadId,null);
      if(presentation.page && !presentation.page.isClosed() && new URL(presentation.page.url()).origin===origin) return presentation;
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw Error('fake-page-not-owned');
}

async function waitBusySettled(controller,threadId) {
  const end=Date.now()+20_000;
  while(Date.now()<end && controller.state.threadId===threadId && (controller.state.busy || controller.state.questions?.length))
    await new Promise(resolve=>setTimeout(resolve,200));
  if(controller.state.threadId!==threadId || controller.state.busy || controller.state.questions?.length) throw Error('model-state-not-settled');
}

async function oneTurn(owner,controller,threadId,origin,label,prompt,expected,expectedTools) {
  const before=controller.state.messages.length,toolStart=controller.state.tools.length;
  if(controller.state.busy || controller.state.questions?.length) throw Error('turn-start-not-idle');
  progress('model-turn-start',{label});
  const deadline=Date.now()+TURN_TIMEOUT_MS;
  // Send exactly once. A failure after this point is never retried.
  let timer;
  try {
    await Promise.race([controller.send({threadId,text:prompt}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('model-turn-timeout')),Math.max(1,deadline-Date.now()));}),cancelSignal]);
    const {final,names}=await waitForTurn(owner,controller,threadId,before,toolStart,origin,label,expectedTools,deadline);
    if(!names.length || names.some(name=>!ALLOWED_TOOLS.has(name))) throw Error('expected-browser-tools-not-observed');
    const text=String(final.text??'');
    if(expected && !text.includes(expected)) throw Error('model-did-not-report-expected-marker');
    return {toolNames:names,reportedExpected:expected?text.includes(expected):null};
  } catch(error) {
    if(controller.state.threadId===threadId && (controller.state.busy || controller.state.questions?.length)) {
      try { await stopProbeTurn(controller,threadId); }
      catch { throw Error('turn-stop-unconfirmed'); }
    }
    throw error;
  } finally { clearTimeout(timer); }
}

function nativeInput(page, nativeContents, marker) {
  return page.evaluate(async()=>{
    await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.scrollTo(0,0);
    await new Promise(resolve=>requestAnimationFrame(resolve));
  }).then(()=>page.locator('#note').boundingBox()).then(async rect=>{
    if(!rect) throw Error('fake-note-not-visible');
    const zoom=await nativeContents.getZoomFactor();
    if(!Number.isFinite(zoom)||zoom<=0) throw Error('native-zoom-invalid');
    const x=Math.round((rect.x+rect.width/2)*zoom),y=Math.round((rect.y+rect.height/2)*zoom);
    nativeContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
    nativeContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
    nativeContents.insertText(marker);
  });
}

let owner,site,controller,activeThread=null,cancelRequested=false,finished=false,evidencePath=null;
let cancelResolve;
const cancelSignal=new Promise((_,reject)=>{cancelResolve=()=>reject(Error('parent-cancelled'));});
cancelSignal.catch(()=>{});
process.on('message',message=>{
  if(message?.type==='test-cancel'){
    cancelRequested=true;
    cancelResolve?.();
  }
});

async function run() {
  if(typeof process.send!=='function'||!process.connected) throw Error('private-parent-required');
  const pathsModule=await import(pathToFileURL(path.join(runtimeRoot,'src','isolated-launcher.mjs')).href);
  const paths=pathsModule.isolatedLauncherPaths(candidateRoot);
  paths.trustedRuntime=runtimeRoot;
  paths.bridgePath=path.join(runtimeRoot,'src','sandboxie-stdio-bridge.mjs');
  const runTag=`native-model-${Date.now()}-${runId.slice(0,8)}`;
  paths.stateRoot=path.join(paths.vault,`${runTag}-state`);
  // Retain the already-authorized workspace/output policy roots. The models
  // receive only the fake URL, no file tasks; state and profiles remain new.
  paths.browserProfiles=path.join(paths.vault,'profiles',runTag);
  await fs.mkdir(paths.stateRoot,{recursive:false});
  await fs.mkdir(path.join(paths.stateRoot,'.runtime'),{recursive:false});
  await fs.writeFile(path.join(paths.stateRoot,'.runtime','browser-mcp.json'),' {"enabled":true} ',{flag:'wx'});
  await fs.mkdir(paths.browserProfiles,{recursive:true});
  await fs.mkdir(paths.browserOutput,{recursive:true});
  evidencePath=path.join(paths.stateRoot,'native-model-pilot-evidence.json');
  send({type:'test-run-path',runId, stateRoot:paths.stateRoot, workspace:paths.workspace, evidencePath});

  site=await makeFakeSite();
  progress('fake-site-ready',{origin:site.origin});
  const injected=async({gatewayFactory})=>{
    const {startIsolatedOwner}=await import(pathToFileURL(path.join(runtimeRoot,'src/isolated-launcher.mjs')).href);
    return startIsolatedOwner({paths,nodeExecutable:process.env.K_ISOLATED_PARENT_NODE_EXECUTABLE,gatewayFactory});
  };
  owner=await startNativeOwner({servicesFactory:injected,paths,userDataPath:path.join(paths.vault,`${runTag}-native-shell`)});
  controller=owner.services.app.controller;
  send({type:'test-ready',runId, stateRoot:paths.stateRoot, origin:site.origin, pid:process.pid});

  const catalog=await controller.models();
  progress('model-catalog',{models:catalog.models.map(({model,provider,supportedReasoningEfforts,available})=>({model,provider,supportedReasoningEfforts,available})),warnings:catalog.warnings});
  const codex=catalog.models.find(row=>row.model==='gpt-6-luna'&&row.provider==='codex');
  const claude=catalog.models.find(row=>row.model==='claude-opus-5-5'&&row.provider==='claude'&&row.available===true);
  if(!codex || !(codex.supportedReasoningEfforts??[]).some(item=>(typeof item==='string'?item:item.reasoningEffort)==='high')) throw Error('required-codex-model-unavailable');
  if(!claude) throw Error('required-claude-model-unavailable');
  const evidence={schema:1,scope:'fake-site-only',runId,providers:[],nativePresentation:false,humanTakeover:false,releaseLocked:false,completed:false};

  const providers=[
    {model:'gpt-6-luna',provider:'codex',effort:'high',accessMode:'workspace-write',
      first:`只操作這個假網頁 ${site.url}。只用 k_browser 的 browser_navigate、browser_resize（1280x720）、browser_snapshot、browser_click。請 navigate 到提供的假網址，resize 到 1280x720，snapshot，點擊「Fake login」按鈕，snapshot 確認顯示 FAKE_LOGIN_OK 與 fake-cookie=yes。不要使用其他工具、URL、檔案或 shell；回報假 marker 與 cookie 字樣。`,
      second:'只用 k_browser 的 browser_snapshot 檢查目前同一個假頁；請原樣回報 Note 欄位目前的完整值，以及 fake-cookie 顯示的狀態，不得使用其他工具，不要猜測文字。',
    },
    {model:'claude-opus-5-5',provider:'claude',effort:'high',accessMode:'claude-manual',
      first:`只操作目前這個假網頁 ${site.url}。只用 k_browser 的 browser_navigate、browser_resize（1280x720）、browser_snapshot、browser_click。請 navigate 到提供的假網址，resize 到 1280x720，snapshot，點擊「Fake login」按鈕，snapshot 確認顯示 FAKE_LOGIN_OK 與 fake-cookie=yes。不要使用其他工具、URL、檔案或 shell；回報假 marker 與 cookie 字樣。`,
      second:'只用 k_browser 的 browser_snapshot 檢查目前同一個假頁；請原樣回報 Note 欄位目前的完整值，以及 fake-cookie 顯示的狀態，不得使用其他工具，不要猜測文字。',
    },
  ];
  for(const item of providers.filter(item=>!process.argv.includes('--only-claude')||item.provider==='claude')){
    if(cancelRequested) throw Error('parent-cancelled');
    const opened=await controller.open({model:item.model,effort:item.effort,accessMode:item.accessMode,workspace:paths.workspace});
    activeThread=opened.threadId;
    if(!activeThread) throw Error('provider-thread-missing');
    const threadId=activeThread;
    if(!controller.state.browserAccess?.enabled || !controller.state.browserAccess?.sessionKey) throw Error('browser-mcp-not-enabled');
    const first=await oneTurn(owner,controller,threadId,site.origin,`${item.provider}-1`,item.first,'FAKE_LOGIN_OK','first');
    await waitBusySettled(controller,threadId);
    const presentation=await waitPage(owner,controller,site.origin);
    const page=presentation.page;
    if(await page.locator('#marker').innerText()!=='FAKE_LOGIN_OK' || !await page.locator('#cookie').innerText().then(x=>x.includes('fake-cookie=yes')) || !await page.evaluate(()=>document.cookie.includes('k_fake_login=ok'))) throw Error('fake-login-dom-check-failed');
    const [width,height]=owner.window.getContentSize();
    const rect={x:Math.floor(width*.45),y:0,width:Math.max(1,Math.ceil(width*.55)),height:Math.max(1,height)};
    if(!owner.window.isVisible()) throw Error('native-window-not-visible');
    const shown=await owner.views.show(page,rect);
    if(!shown) throw Error('native-view-not-shown');
    const layers=owner.window.contentView.children;
    const browserView=layers.find((view,index)=>index>layers.indexOf(owner.owner)&&view.webContents?.getURL?.().startsWith(site.origin));
    if(!browserView || owner.window.contentView.children.indexOf(browserView)<=owner.window.contentView.children.indexOf(owner.owner)) throw Error('native-view-not-above-owner');
    const nativeContents=browserView.webContents;
    evidence.nativePresentation=true;
    progress('native-page-visible',{provider:item.provider});

    const uniqueMarker=`K_HUMAN_${runId}_${item.provider.toUpperCase()}`;
    // Registry-mediated request validates active thread/session scope; no raw human route is exposed to a model.
    const action=await owner.services.browsers.request(null,controller.state,threadId,'/action',{type:'takeover'});
    const humanState=owner.services.browsers.controlSnapshot(controller.state,threadId);
    if(humanState.mode!=='human' || humanState.humanInputAllowed!==true || action.mode!=='human') throw Error('human-takeover-not-unlocked');
    evidence.humanTakeover=true;
    await nativeInput(page,nativeContents,uniqueMarker);
    await page.waitForFunction(expected=>document.querySelector('#marker')?.textContent===`HUMAN_NOTE:${expected}` && document.querySelector('#note')?.value===expected,uniqueMarker,{timeout:10_000});
    const release=await owner.services.browsers.request(null,controller.state,threadId,'/action',{type:'release'});
    const locked=owner.services.browsers.controlSnapshot(controller.state,threadId);
    if(release.mode!=='ai'||locked.mode!=='ai'||locked.humanInputAllowed!==false) throw Error('ai-release-did-not-lock-human-input');
    evidence.releaseLocked=true;

    const second=await oneTurn(owner,controller,threadId,site.origin,`${item.provider}-2`,item.second,uniqueMarker,'snapshot');
    const after=await page.locator('#marker').innerText();
    if(after!==`HUMAN_NOTE:${uniqueMarker}`) throw Error('human-marker-not-preserved');
    evidence.providers.push({provider:item.provider,model:item.model,effort:item.effort,turns:2,
      firstTools:first.toolNames,secondTools:second.toolNames,humanMarkerRoundTrip:true,cookieRoundTrip:true});
    progress('provider-complete',{provider:item.provider});
    await waitBusySettled(controller,threadId);
    activeThread=null;
  }
  evidence.completed=true;
  await fs.writeFile(evidencePath,JSON.stringify(evidence,null,2),{flag:'wx'});
  send({type:'test-result',runId,ok:true,evidencePath,result:evidence});
}

async function cleanup() {
  if(finished)return;finished=true;
  try { await site?.server.closeAllConnections?.(); } catch {}
  if(site?.server?.listening) await new Promise(resolve=>site.server.close(()=>resolve()));
}

run().catch(async error=>{
  if(activeThread && controller?.state.threadId===activeThread && (controller.state.busy || controller.state.questions?.length)) {
    try { await stopProbeTurn(controller,activeThread); }
    catch { error=Error('turn-stop-unconfirmed'); }
  }
  const code=String(error?.message??'pilot-failed').replace(/[^a-z0-9-]/gi,'-').slice(0,80)||'pilot-failed';
  try {
    const result={schema:1,scope:'fake-site-only',runId,ok:false,failure:{code},completed:false};
    if(evidencePath) await fs.writeFile(evidencePath.replace(/native-model-pilot-evidence\.json$/u,'native-model-pilot-failure.json'),JSON.stringify(result,null,2),{flag:'wx'}).catch(()=>{});
    send({type:'test-result',runId,ok:false,errorCode:code,evidencePath:evidencePath??undefined});
  } catch {}
}).finally(()=>cleanup());
