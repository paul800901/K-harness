import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createBrowserLiveSession} from '../src/browser-live-session.mjs';

function fakeContext(){
  const listeners={};
  const context={
    pages:()=>context._pages.filter(page=>!page.closed),
    _pages:[],
    on:(name,fn)=>listeners[name]=fn,
    emit:(name,...args)=>listeners[name]?.(...args),
    async newCDPSession(page){return {send:async()=>({currentIndex:page.historyIndex??0,entries:Array.from({length:page.historyLength??1},(_,id)=>({id}))}),detach:async()=>{}};},
    async newPage(){const page=fakePage();context._pages.push(page);listeners.page?.(page);return page;},
    async close(){listeners.close?.();},
  };
  return context;
}
function fakePage(){
  let address='about:blank';
  const documentTitle='fixture';
  const navigations=[];
  const listeners={};
  const page={closed:false,title:async()=>'',evaluate:async()=>documentTitle,url:()=>address,isClosed:()=>page.closed,
    goto:async url=>{address=url;navigations.push('goto');},goBack:async()=>navigations.push('back'),goForward:async()=>navigations.push('forward'),reload:async()=>navigations.push('reload'),navigations,close:async()=>{page.closed=true;},screenshot:async()=>Buffer.from('jpeg'),
    on:(name,fn)=>listeners[name]=fn,emit:(name,...args)=>listeners[name]?.(...args),
    mouse:{click:async()=>{},wheel:async()=>{}},keyboard:{insertText:async()=>{},press:async()=>{}},};
  return page;
}
async function request(session,route,{body}={}){return session.humanRequest(route,body);}

test('externally owned contexts do not probe browser processes or prepare local download history',async()=>{
 const profile=await mkdtemp(path.join(os.tmpdir(),'k-external-no-probe-'));
 const original=childProcess.execFile;let calls=0;
 childProcess.execFile=(...args)=>{calls++;args.at(-1)(Error('External browsers must not require a process scan'));};
 syncBuiltinESMExports();
 // An external wrapper is not a Chrome profile; this must never be opened as SQLite.
 await writeFile(path.join(profile,'History'),'not a browser profile');
 const context=fakeContext();context._pages.push(fakePage());let session;
 try{
  session=await createBrowserLiveSession(profile,{launchContext:async()=>context});
  assert.equal(await session.contextGetter(),context);
  assert.equal(calls,0);
  assert.equal(await readFile(path.join(profile,'History'),'utf8'),'not a browser profile');
 }finally{await session?.close();childProcess.execFile=original;syncBuiltinESMExports();}
});

test('in-process controls wait for MCP work and share the supplied context',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'k-live-browser-'));
  const context=fakeContext();context._pages.push(fakePage());
  const session=await createBrowserLiveSession(profile,{launchContext:async()=>context});
  try{
    assert.equal(session.ownerPresentation,undefined,'HTTP sessions do not expose the native page capability');
    assert.equal(session.beginAiCall(),true);
    const takeover=await request(session,'/action',{method:'POST',body:{type:'takeover'}});
    assert.equal((await takeover.json()).busy,true);
    const gated=await request(session,'/action',{method:'POST',body:{type:'click',x:5,y:5}});assert.equal(gated.status,400);
    session.endAiCall();
    const created=await request(session,'/action',{method:'POST',body:{type:'newPage'}});
    const state=await created.json();assert.equal(state.mode,'human');assert.equal(state.pages.length,2);
    const second=state.selectedPageId;assert.ok(second);
    const nav=await request(session,'/action',{method:'POST',body:{type:'navigate',pageId:second,url:'https://example.test/path'}});
    assert.equal((await nav.json()).pages.find(page=>page.id===second).url,'https://example.test/path');
    const page=context.pages().find(p=>p.url()==='https://example.test/path');page.historyIndex=1;page.historyLength=2;
    const controls=await (await request(session,'/state')).json();
    assert.equal(controls.pages.find(item=>item.id===second).canGoBack,true);assert.equal(controls.pages.find(item=>item.id===second).canGoForward,false);
    for(const type of ['back','forward','reload'])assert.equal((await request(session,'/action',{method:'POST',body:{type,pageId:second}})).status,200);
    assert.deepEqual(page.navigations,['goto','back','forward','reload']);
    const unsafe=await request(session,'/action',{method:'POST',body:{type:'navigate',pageId:second,url:'file:///secret'}});assert.equal(unsafe.status,400);
    const frame=await request(session,`/frame?pageId=${second}`);assert.equal(frame.headers.get('content-type'),'image/jpeg');
    const released=await request(session,'/action',{method:'POST',body:{type:'release'}});assert.equal((await released.json()).mode,'ai');
    const blocked=await request(session,'/action',{method:'POST',body:{type:'click',x:5,y:5}});assert.equal(blocked.status,400);
  }finally{await session.close();}
});

test('browser tab title state reads the current document title rather than a stale Playwright title cache',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'k-live-browser-title-'));
  const context=fakeContext();context._pages.push(fakePage());
  const session=await createBrowserLiveSession(profile,{launchContext:async()=>context});
  try{
    await session.contextGetter();
    const state=await session.getState();
    assert.equal(await context.pages()[0].title(), '');
    assert.equal(state.pages[0].title,'fixture');
  }finally{await session.close();}
});

test('the MCP reload capability uses Playwright reload on the indexed existing page',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'k-live-browser-reload-'));
  const context=fakeContext();context._pages.push(fakePage(),fakePage());
  const session=await createBrowserLiveSession(profile,{launchContext:async()=>context});
  try{
    await session.contextGetter();
    const before=await session.getState();
    await session.reloadPageAtIndex(1);
    assert.deepEqual(context.pages().map(page=>page.navigations),[[],['reload']]);
    assert.deepEqual((await session.getState()).pages.map(page=>page.id),before.pages.map(page=>page.id),'reload preserves page identity and does not create a tab');
    await assert.rejects(session.reloadPageAtIndex(2),/Unknown or closed browser page/u);
  }finally{await session.close();}
});

test('explicit in-process control reuses the same state/action/frame routes without listener or token file',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'k-live-browser-inproc-'));
  const context=fakeContext();context._pages.push(fakePage());
  const session=await createBrowserLiveSession(profile,{launchContext:async()=>context});
  try{
    assert.equal(typeof session.humanRequest,'function');
    await assert.rejects(readFile(path.join(profile,'live.json')),error=>error.code==='ENOENT');
    const takeover=await session.humanRequest('/action',{type:'takeover'});assert.equal((await takeover.json()).mode,'human');
    const frame=await session.humanRequest(`/frame?pageId=${(await session.getState()).selectedPageId}`);assert.equal(frame.headers.get('content-type'),'image/jpeg');assert.equal(await frame.text(),'jpeg');
    const released=await session.humanRequest('/action',{type:'release'});assert.equal((await released.json()).mode,'ai');
  }finally{await session.close();}
});

test('in-process control changes lock before AI calls and release',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'k-live-browser-native-'));
  const context=fakeContext();context._pages.push(fakePage());
  let session;
  const changes=[];
  session=await createBrowserLiveSession(profile,{launchContext:async()=>context,onControlChange:snapshot=>{
    changes.push({snapshot,actual:session?.getControlSnapshot()??null});
  }});
  try{
    await session.contextGetter();

    assert.equal(session.beginAiCall(),true);
    const aiLock=changes.at(-1);
    assert.equal(aiLock.snapshot.humanInputAllowed,false);
    assert.equal(aiLock.snapshot.aiCalls,1);
    assert.equal(aiLock.actual.aiCalls,0,'the native lock callback runs before the AI call is admitted');

    await session.humanRequest('/action',{type:'takeover'});
    assert.equal(session.getControlSnapshot().mode,'human');
    assert.equal(session.getControlSnapshot().humanInputAllowed,false,'takeover cannot enable human input while an AI call is active');
    session.endAiCall();
    assert.equal(session.getControlSnapshot().humanInputAllowed,true,'human input becomes available only after the last AI call ends in takeover mode');

    await session.humanRequest('/action',{type:'release'});
    const releaseLock=changes.at(-1);
    assert.equal(releaseLock.snapshot.mode,'ai');
    assert.equal(releaseLock.snapshot.humanInputAllowed,false);
    assert.equal(releaseLock.actual.mode,'human','the native input lock is applied before mode switches back to AI');
    assert.equal(session.getControlSnapshot().mode,'ai');
    assert.equal(session.getControlSnapshot().humanInputAllowed,false);
  }finally{await session.close();}
});

test('native download events are saved under UUID directories and only completed files are served',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'k-live-browser-download-'));
  const downloadDirectory=path.join(profile,'output','downloads');
  const upstreamTarget=path.join(path.dirname(downloadDirectory),'probe.txt');
  const context=fakeContext();context._pages.push(fakePage());
  const session=await createBrowserLiveSession(profile,{launchContext:async()=>context,downloadDirectory});
  try{
    await session.contextGetter();
    const pending=Promise.withResolvers();
    const finishDownload=Promise.withResolvers();
    const nativeDownload={suggestedFilename:()=> 'C:\\temp\\report.txt',url:()=> 'https://user:password@example.test/path?token=secret#fragment',saveAs:async target=>{
      const fs=await import('node:fs/promises');
      if(target===upstreamTarget){await fs.writeFile(target,'MCP copy');return;}
      pending.resolve(target);await finishDownload.promise;await fs.writeFile(target,'download body');
    }};
    context.pages()[0].emit('download',nativeDownload);
    await nativeDownload.saveAs(upstreamTarget);
    assert.equal(await readFile(upstreamTarget,'utf8'),'MCP copy');
    await assert.rejects(nativeDownload.saveAs(upstreamTarget),/already exists/);
    await assert.rejects(nativeDownload.saveAs(path.join(profile,'outside','probe.txt')),/outside the session output directory/);
    if(process.platform==='win32')assert.equal(await readFile(`${upstreamTarget}:Zone.Identifier`,'utf8'),'[ZoneTransfer]\r\nZoneId=3\r\n');
    const target=await pending.promise;
    const downloading=await (await request(session,'/state')).json();assert.equal(downloading.downloads[0].status,'downloading');
    finishDownload.resolve();
    for(let n=0;n<20&&(await (await request(session,'/state')).json()).downloads?.[0]?.status!=='completed';n++)await new Promise(resolve=>setTimeout(resolve,5));
    const state=await (await request(session,'/state')).json();
    const item=state.downloads[0];assert.equal(item.name,'report.txt');assert.equal(item.status,'completed');assert.equal(item.sourceUrl,'https://example.test');assert.equal(item.dangerous,false);assert.equal(item.size,13);assert.equal(item.copyAvailable,true);assert.equal(item.zoneMarked,process.platform==='win32'?true:'unsupported');assert.equal(Object.hasOwn(item,'path'),false);
    assert.doesNotMatch(JSON.stringify(item),/password|secret|fragment/);
    if(process.platform==='win32')assert.equal(await readFile(`${target}:Zone.Identifier`,'utf8'),'[ZoneTransfer]\r\nZoneId=3\r\n');
    const incomplete=await request(session,'/download?id=00000000-0000-0000-0000-000000000000');assert.equal(incomplete.status,400);
    const response=await request(session,`/download?id=${item.id}`);assert.equal(response.status,200);assert.equal(response.headers.get('content-disposition'),"attachment; filename*=UTF-8''report.txt");assert.equal(await response.text(),'download body');
    assert.ok(path.dirname(target).startsWith(downloadDirectory));
    const reservedTarget=Promise.withResolvers();
    context.pages()[0].emit('download',{suggestedFilename:()=> 'cOn .txt',url:()=> 'data:text/plain,hidden',saveAs:async destination=>{reservedTarget.resolve(destination);await import('node:fs/promises').then(fs=>fs.writeFile(destination,'x'));}});
    const safeReservedPath=await reservedTarget.promise;
    for(let n=0;n<20&&(await (await request(session,'/state')).json()).downloads?.[1]?.status!=='completed';n++)await new Promise(resolve=>setTimeout(resolve,5));
    const reserved=(await (await request(session,'/state')).json()).downloads[1];
    assert.equal(path.basename(safeReservedPath),'_cOn .txt');assert.equal(reserved.dangerous,false);assert.equal(reserved.sourceUrl,'');
    const dangerousTarget=Promise.withResolvers();
    context.pages()[0].emit('download',{suggestedFilename:()=> 'setup.EXE',url:()=> 'https://example.test/install?sig=hidden',saveAs:async destination=>{await import('node:fs/promises').then(async fs=>{await fs.writeFile(destination,'x');await fs.truncate(destination,64*1024*1024+1);});dangerousTarget.resolve(destination);}});
    await dangerousTarget.promise;
    for(let n=0;n<20&&(await (await request(session,'/state')).json()).downloads?.[2]?.status!=='completed';n++)await new Promise(resolve=>setTimeout(resolve,5));
    const dangerous=(await (await request(session,'/state')).json()).downloads[2];assert.equal(dangerous.dangerous,true);assert.equal(dangerous.sourceUrl,'https://example.test');
    const overLimit=(await (await request(session,'/state')).json()).downloads[2];assert.equal(overLimit.size,64*1024*1024+1);assert.equal(overLimit.copyAvailable,false);
    const blockedCopy=await request(session,`/download?id=${overLimit.id}`);assert.equal(blockedCopy.status,400);
    context.pages()[0].emit('download',{suggestedFilename:()=> 'broken.txt',saveAs:async()=>{throw new Error('private filesystem detail');}});
    for(let n=0;n<20&&(await (await request(session,'/state')).json()).downloads?.[3]?.status!=='failed';n++)await new Promise(resolve=>setTimeout(resolve,5));
    const failed=(await (await request(session,'/state')).json()).downloads[3];assert.equal(failed.status,'failed');assert.equal(failed.error,'下載未能安全保存，請重新確認網站與下載位置。');
    const failedFile=await request(session,`/download?id=${failed.id}`);assert.equal(failedFile.status,400);
  }finally{await session.close();}
});

test('a failed download does not close the browser or prevent later human and AI work',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'k-live-download-failure-'));
  const context=fakeContext();context._pages.push(fakePage());
  let closed=false;const originalClose=context.close;context.close=async()=>{closed=true;await originalClose();};
  const session=await createBrowserLiveSession(profile,{launchContext:async()=>context,downloadDirectory:path.join(profile,'output','downloads')});
  try{
    await session.contextGetter();await request(session,'/action',{method:'POST',body:{type:'takeover'}});
    context.pages()[0].emit('download',{suggestedFilename:()=> 'fake.exe',saveAs:async()=>{throw new Error('download cancelled');}});
    for(let n=0;n<50&&(await session.getState()).downloads[0]?.status!=='failed';n++)await new Promise(r=>setTimeout(r,5));
    const state=await session.getState();assert.equal(state.downloads[0].status,'failed');assert.equal(state.available,true);assert.equal(state.busy,false);assert.equal(state.recoveryRequired,false);assert.equal(closed,false);
    for(const body of [{type:'navigate',url:'https://fixture.test/after-failure'},{type:'click',x:10,y:10},{type:'release'}])assert.equal((await request(session,'/action',{method:'POST',body})).status,200);
    assert.equal(session.beginAiCall(),true);session.endAiCall();assert.equal(closed,false);
  }finally{await session.close();}
});

test('unexpected browser close fails closed for AI and human input',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'k-live-browser-close-'));
  const context=fakeContext();const session=await createBrowserLiveSession(profile,{launchContext:async()=>context});
  try{
    await session.contextGetter();
    await context.close();
    assert.equal(session.beginAiCall(),false);
    const result=await request(session,'/action',{method:'POST',body:{type:'takeover'}});
    assert.equal(result.status,400);
  }finally{await session.close();}
});

test('fail-closed keeps an unavailable state endpoint and releases busy only after browser close',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'k-live-browser-cancel-'));
  let finishClose;const closeGate=new Promise(resolve=>finishClose=resolve);
  const context=fakeContext();context.close=async()=>{await closeGate;};
  const session=await createBrowserLiveSession(profile,{launchContext:async()=>context});
  try{
    await session.contextGetter();assert.equal(session.beginAiCall(),true);
    const failing=session.failClosed();
    assert.equal(session.beginAiCall(),false,'unavailable must take effect before browser shutdown completes');
    let state=await (await request(session,'/state')).json();
    assert.equal(state.available,false);assert.equal(state.busy,true);
    const takeover=await request(session,'/action',{method:'POST',body:{type:'takeover'}});assert.equal(takeover.status,400);
    finishClose();await failing;session.endAiCall();
    state=await (await request(session,'/state')).json();
    assert.equal(state.available,false);assert.equal(state.busy,false);assert.equal(state.mode,'human');assert.match(state.error,/重新開啟對話/);assert.equal(state.recoveryRequired,true);
  }finally{finishClose();await session.close();}
});

test('takeover reserves human control while the lazy context launch is pending',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'k-live-browser-race-'));
  let finishLaunch;
  const launchGate=new Promise(resolve=>finishLaunch=resolve);
  const context=fakeContext();
  const session=await createBrowserLiveSession(profile,{launchContext:async()=>{await launchGate;return context;}});
  try{
    const takingOver=request(session,'/action',{method:'POST',body:{type:'takeover'}});
    await new Promise(resolve=>setTimeout(resolve,0));
    const state=await (await request(session,'/state')).json();
    assert.equal(state.mode,'human');assert.equal(state.busy,true);
    const release=await request(session,'/action',{method:'POST',body:{type:'release'}});assert.equal(release.status,400);
    const input=await request(session,'/action',{method:'POST',body:{type:'click',x:5,y:5}});assert.equal(input.status,400);
    finishLaunch();
    const ready=await (await takingOver).json();assert.equal(ready.mode,'human');assert.equal(ready.busy,false);assert.equal(ready.pages.length,1);
  }finally{finishLaunch();await session.close();}
});
