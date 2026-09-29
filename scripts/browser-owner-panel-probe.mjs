import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startDesktop} from '../src/desktop-server.mjs';
import {createOwnerBrowserRegistry} from '../src/owner-browser-registry.mjs';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidenceRoot=path.join(projectRoot,'.runtime','isolation-pilot','sandboxie-candidate-3b6c43ee','vault','ui-probe');
const runRoot=path.join(evidenceRoot,`run-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}`);
const profiles=path.join(runRoot,'profiles'),outputs=path.join(runRoot,'outputs'),workspace=path.join(runRoot,'fake-workspace');
await Promise.all([evidenceRoot,profiles,outputs,workspace].map(directory=>mkdir(directory,{recursive:true})));

process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(projectRoot,'.runtime','playwright-browsers');
const {chromium}=await import('playwright');
const chromiumExecutable=path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,'chromium-1246','chrome-win64','chrome.exe');
const conversationId='owner-ui-fixture';
const state={
  status:'ready',threadId:conversationId,provider:'codex',model:'gpt-6-sol',modelDisplayName:'Fixture controller',title:'隔離瀏覽器面板假資料驗證',
  workspace,browserAccess:{enabled:true,networkAccess:true,sessionKey:conversationId},messages:[],tools:[],workers:[],artifacts:[],turnDiffs:[],questions:[],notices:[],reasoning:[],modelChanges:[],
  accessMode:'workspace-write',usage:{codex:{status:'unavailable',windows:[]},claude:{status:'unavailable',windows:[]},flash:{totalTokens:0,responses:0,unconfirmed:0,pending:0}},
  progress:{plan:[],explanation:null,compaction:'idle',compactions:0,tokenUsage:null},capabilities:{},busy:false,
};
let uiContext=null,ownerContext=null,ownerGateway=null,desktop=null,registry=null,fakeSite=null;
const serverListen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const serverClose=server=>new Promise(resolve=>{if(!server?.listening)return resolve();server.close(()=>resolve());});
const waitFor=async(read,assertion,label,timeout=15000)=>{
  const end=Date.now()+timeout;let last;
  while(Date.now()<end){
    last=await read();
    try{assertion(last);return last;}catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(last)}`);
};

async function main(){
  let ownerMcpConfig;
  fakeSite=http.createServer((req,res)=>{
    if(req.url!=='/') {res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>LOCAL FAKE PAGE</title></head><body style="margin:0;font:20px sans-serif"><h1 style="margin:12px">本機假頁面</h1><input id="probe" aria-label="Fake input" style="position:absolute;left:32px;top:48px;width:480px;height:40px;font:20px sans-serif"><p id="receipt" style="position:absolute;left:32px;top:110px">僅測試資料</p><div id="frame-marker" style="position:absolute;left:700px;top:100px;width:200px;height:80px;background:rgb(18,102,204);color:white;padding:8px">FRAME_READY_K</div></body></html>');
  });
  await serverListen(fakeSite);
  const fakeUrl=`http://127.0.0.1:${fakeSite.address().port}/`;

  registry=createOwnerBrowserRegistry({vault:profiles,outputRoot:outputs,gatewayFactory:async options=>{
    const browserGateway=await (await import('../src/browser-owner-gateway.mjs')).createBrowserOwnerGateway({
      ...options,
      launchContext:async(profile,viewport)=>{
        ownerContext=await chromium.launchPersistentContext(profile,{executablePath:chromiumExecutable,headless:true,viewport,serviceWorkers:'block',args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--disable-default-apps']});
        await ownerContext.route('**/*',route=>{
          const target=new URL(route.request().url());
          if(target.protocol==='http:'&&(target.hostname==='127.0.0.1'||target.hostname==='localhost'))return route.continue();
          return route.abort();
        });
        return ownerContext;
      },
    });
    ownerGateway=browserGateway;return browserGateway;
  }});
  const browserSession=registry.session();
  ownerMcpConfig=await browserSession.config({conversationId,provider:'codex',accessMode:'workspace-write'});
  assert.equal(typeof ownerMcpConfig.url,'string');
  assert.equal(typeof ownerMcpConfig.http_headers?.Authorization,'string');

  const fixtureController={state,concurrentConversations:true,
    async sessions(){return {sessions:[{threadId:conversationId,title:state.title,workspace,model:state.model,provider:'codex',accessMode:'workspace-write',busy:false}],unreadable:0};},
    async usage(){return state.usage;},async close(){},
  };
  desktop=await startDesktop({root:runRoot,executable:'fixture-controller-no-model',port:0,requireLaunchToken:true,controllerFactory:()=>fixtureController,browserRequest:(root,currentState,threadId,route,body)=>registry.request(root,currentState,threadId,route,body)});

  const uiProfile=path.join(runRoot,'ui-driver-profile');
  uiContext=await chromium.launchPersistentContext(uiProfile,{executablePath:chromiumExecutable,headless:true,viewport:{width:1600,height:1000},serviceWorkers:'block',args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--disable-default-apps']});
  await uiContext.route('**/*',route=>{
    const target=new URL(route.request().url());
    if(target.protocol==='http:'&&target.hostname==='127.0.0.1')return route.continue();
    return route.abort();
  });
  const page=uiContext.pages()[0]??await uiContext.newPage();
  const browserErrors=[],capturedUiFrames=[],frameResponseRecords=[];let frameNumber=0;page.on('pageerror',error=>browserErrors.push(error.message));
  page.on('response',response=>{if(new URL(response.url()).pathname==='/api/browser/frame'){const number=++frameNumber;capturedUiFrames.push(response.body().then(async body=>{const target=path.join(runRoot,`ui-poll-frame-${number}.jpg`);await writeFile(target,body);frameResponseRecords.push({name:path.basename(target),status:response.status(),length:body.length,sha256:createHash('sha256').update(body).digest('hex')});}).catch(()=>{}));}});
  const launchUrl=desktop.createLaunchUrl();
  await page.goto(launchUrl,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:state.title}).waitFor();
  await waitFor(()=>page.evaluate(async()=>({online:(await fetch('/api/state')).ok})),value=>assert.equal(value.online,true),'fixture UI session');
  await page.getByRole('button',{name:'切換工具與成果面板'}).click();
  await page.getByRole('button',{name:'新增工作面板'}).click();
  await page.getByRole('menuitem',{name:'瀏覽器'}).click();
  await page.getByRole('button',{name:'開啟並接手'}).waitFor();
  await page.getByRole('button',{name:'開啟並接手'}).click();

  await page.getByRole('textbox',{name:'瀏覽器網址'}).waitFor();
  const address=page.getByRole('textbox',{name:'瀏覽器網址'});
  await address.fill(fakeUrl);await address.press('Enter');
  const image=page.getByRole('img',{name:'目前瀏覽器頁面快照；每秒更新一次'});
  const snapshot=async()=>page.evaluate(async threadId=>{
    const response=await fetch(`/api/browser/state?threadId=${encodeURIComponent(threadId)}`,{headers:{'X-K-Request':'1'}});
    return {status:response.status,state:await response.json()};
  },conversationId);
  const live=await waitFor(snapshot,result=>{assert.equal(result.status,200);assert.equal(result.state.pages?.find(candidate=>candidate.id===result.state.selectedPageId)?.url,fakeUrl);assert.equal(result.state.mode,'human');},'same selected fake page in right panel');
  const ownerPage=ownerContext.pages().find(candidate=>candidate.url()===fakeUrl);assert(ownerPage,'the owned Playwright context should contain the fake page');
  await ownerPage.locator('#frame-marker').waitFor({state:'visible'});
  await ownerPage.screenshot({path:path.join(runRoot,'owner-page-direct.png')});
  const directJpeg=await ownerPage.screenshot({type:'jpeg',quality:70});await writeFile(path.join(runRoot,'owner-page-direct.jpg'),directJpeg);
  const rawFrame=await ownerGateway.humanRequest('/frame');await writeFile(path.join(runRoot,'owner-api-frame.jpg'),Buffer.from(await rawFrame.arrayBuffer()));
  const uiFrame=await page.evaluate(async threadId=>{const response=await fetch(`/api/browser/frame?threadId=${encodeURIComponent(threadId)}`,{headers:{'X-K-Request':'1'}});return {status:response.status,body:Array.from(new Uint8Array(await response.arrayBuffer()))};},conversationId);
  assert.equal(uiFrame.status,200);await writeFile(path.join(runRoot,'ui-api-frame.jpg'),Buffer.from(uiFrame.body));
  await image.waitFor();
  await page.waitForFunction(()=>{
    const image=[...document.querySelectorAll('img[alt="目前瀏覽器頁面快照；每秒更新一次"]')].find(candidate=>{const rect=candidate.getBoundingClientRect();return rect.width>100&&rect.height>100&&getComputedStyle(candidate).visibility!=='hidden'&&getComputedStyle(candidate).opacity!=='0';});
    if(!image?.complete||image.naturalWidth<900||image.naturalHeight<600)return false;
    try{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);const [red,green,blue]=context.getImageData(800,140,1,1).data;return blue>100&&blue>red*1.6&&blue>green*1.2;}catch{return false;}
  },undefined,{timeout:15000});
  const renderedFrameBefore=await image.evaluate(async image=>{await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);return {pixel:[...context.getImageData(800,140,1,1).data],dimensions:[image.naturalWidth,image.naturalHeight],sourceLength:image.currentSrc.length};});
  const frameDiagnostics=await page.locator('img[alt="目前瀏覽器頁面快照；每秒更新一次"]').evaluateAll(async images=>Promise.all(images.map(async image=>{await image.decode().catch(()=>{});const rect=image.getBoundingClientRect();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});if(image.complete&&image.naturalWidth)context.drawImage(image,0,0);return {width:image.naturalWidth,height:image.naturalHeight,rect:{x:rect.x,y:rect.y,w:rect.width,h:rect.height},display:getComputedStyle(image).display,visibility:getComputedStyle(image).visibility,opacity:getComputedStyle(image).opacity,pixel:image.naturalWidth?[...context.getImageData(800,140,1,1).data]:null};})));
  await page.screenshot({path:path.join(runRoot,'browser-panel-human.png'),fullPage:true});
  const renderedFrameAfter=await image.evaluate(async image=>{await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);return {pixel:[...context.getImageData(800,140,1,1).data],dimensions:[image.naturalWidth,image.naturalHeight],sourceLength:image.currentSrc.length};});
  await image.screenshot({path:path.join(runRoot,'browser-frame-element.png')});
  const humanImageBounds=await image.boundingBox();
  const capturedMarker=await page.evaluate(async({base64,x,y})=>{
    const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);return [...context.getImageData(x,y,1,1).data];
  },{base64:(await readFile(path.join(runRoot,'browser-panel-human.png'))).toString('base64'),x:Math.round(humanImageBounds.x+humanImageBounds.width*(800/1024)),y:Math.round(humanImageBounds.y+humanImageBounds.height*(140/768))});
  const screenshotBytes=await readFile(path.join(runRoot,'browser-panel-human.png'));
  await Promise.all(capturedUiFrames);
  const screenshotState=await snapshot();
  assert(capturedMarker[2]>100&&capturedMarker[2]>capturedMarker[0]*1.6&&capturedMarker[2]>capturedMarker[1]*1.2,`Saved screenshot does not show fake page marker: ${capturedMarker}; before=${JSON.stringify(renderedFrameBefore)}; after=${JSON.stringify(renderedFrameAfter)}; diag=${JSON.stringify(frameDiagnostics)}; polls=${JSON.stringify(frameResponseRecords)}; state=${JSON.stringify({url:screenshotState.state.url,selectedPageId:screenshotState.state.selectedPageId,pages:screenshotState.state.pages})}; imageBox=${JSON.stringify(humanImageBounds)}; png=${screenshotBytes.readUInt32BE(16)}x${screenshotBytes.readUInt32BE(20)}`);

  const bounds=await image.boundingBox();assert(bounds);
  await page.mouse.click(bounds.x+bounds.width*(102/1024),bounds.y+bounds.height*(68/768));
  await page.getByRole('textbox',{name:'輸入文字到目前網頁欄位'}).fill('K 假資料 UI probe');
  await page.getByRole('button',{name:'送出文字'}).click();
  await waitFor(async()=>ownerContext.pages()[0].locator('#probe').inputValue(),value=>assert.equal(value,'K 假資料 UI probe'),'fake page receives text');
  const afterInput=await snapshot();assert.equal(afterInput.state.mode,'human');assert.equal(afterInput.state.pages[0].url,fakeUrl);

  await page.getByRole('button',{name:'交回 AI'}).click();
  const handedBack=await waitFor(snapshot,result=>assert.equal(result.state.mode,'ai'),'AI handback');
  await page.getByText('由 AI 操作').waitFor();
  await page.screenshot({path:path.join(runRoot,'browser-panel-ai.png'),fullPage:true});
  assert.deepEqual(browserErrors,[]);
  const result={
    result:'PASS',fixtureController:true,modelTurnSent:false,boxedModelUI:false,
    testUrl:fakeUrl,initialMode:live.state.mode,afterInput:'K 假資料 UI probe',finalMode:handedBack.state.mode,
    sameOwnerBrowserPage:handedBack.state.pages.find(candidate=>candidate.id===handedBack.state.selectedPageId)?.url===fakeUrl,
    renderedFrameMarkerPixel:capturedMarker,frameResponses:frameResponseRecords,
    evidence:{humanPanel:path.join(runRoot,'browser-panel-human.png'),aiPanel:path.join(runRoot,'browser-panel-ai.png'),ownerPage:path.join(runRoot,'owner-page-direct.png'),ownerFrame:path.join(runRoot,'owner-api-frame.jpg'),uiFrame:path.join(runRoot,'ui-api-frame.jpg')},
  };
  await writeFile(path.join(runRoot,'result.json'),JSON.stringify(result,null,2));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}

try{await main();}
finally{
  const closeErrors=[];
  for(const close of [()=>uiContext?.close(),()=>registry?.close(),()=>desktop?.close(),()=>serverClose(fakeSite)]){
    try{await close();}catch(error){closeErrors.push(error);}
  }
  if(closeErrors.length)throw new AggregateError(closeErrors,'One or more browser UI probe resources could not be confirmed closed.');
}
