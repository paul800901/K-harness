// Persistent-profile regression probe. Dry-run by default; --run uses only a
// new UUID-scoped profile and a loopback fake HTTP site with synthetic data.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const projectRoot=path.resolve('.');
const probeRoot=path.join(projectRoot,'.runtime','persistent-download-probe');
const run=process.argv.includes('--run');
const chromiumMode=process.argv.includes('--chromium');
const childArg=process.argv.indexOf('--child');
const help=process.argv.includes('--help')||process.argv.includes('-h');
const channel=chromiumMode?'chromium':'msedge';
const roundCount=Number(process.argv.find(arg=>arg.startsWith('--rounds='))?.split('=')[1]??4);
if(!Number.isInteger(roundCount)||roundCount<4||roundCount>10)throw new Error('--rounds must be between 4 and 10');

if(help||!run){
  console.log(JSON.stringify({
    dryRun:true,
    usage:'node scripts/browser-persistent-download-probe.mjs --run [--chromium] [--rounds=8]',
    roundCount,
    browser:channel,
    plan:`New UUID-scoped persistent profile; ${roundCount} separate-process launches; each checks fake auth/storage, 3 synthetic downloads, one canceled download, navigation, takeover/input/release, saved bytes and Windows Zone.Identifier; read-only History and five-batch retention readback. No profile or account outside this probe is used.`,
    writesOnRun:[probeRoot],
  },null,2));
  process.exit(0);
}

const projectBrowsers=path.join(projectRoot,'.runtime','playwright-browsers');
if(chromiumMode){
  process.env.PLAYWRIGHT_BROWSERS_PATH=projectBrowsers;
  try{await access(projectBrowsers);}catch{throw new Error('The project-only Playwright browser directory is unavailable.');}
}

const {createBrowserLiveSession}=await import('../src/browser-live-session.mjs');
const {browserLiveRequest}=await import('../src/browser-live-proxy.mjs');
const {chromium}=await import('playwright');
const scriptPath=fileURLToPath(import.meta.url);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const isLoopback=address=>['127.0.0.1','::ffff:127.0.0.1','::1'].includes(address);

function assert(condition,message){if(!condition)throw new Error(message);}

async function historyReadback(profile,baseUrl,round=null){
  const {DatabaseSync}=await import('node:sqlite');
  const file=path.join(profile,'Default','History');
  let db;
  try{db=new DatabaseSync(file,{readOnly:true});}
  catch(error){return {available:false,error:error.message};}
  try{
    const tableNames=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    const pageUrl=`${baseUrl}/check%`;
    let urlRows=0,visits=0,downloadRows=0,allDownloadRows=0,chains=0,slices=0;
    if(tableNames.has('urls'))urlRows=Number(db.prepare('SELECT COUNT(*) AS n FROM urls WHERE url LIKE ?').get(pageUrl)?.n??0);
    if(tableNames.has('urls')&&tableNames.has('visits'))visits=Number(db.prepare('SELECT COUNT(*) AS n FROM visits v JOIN urls u ON u.id = v.url WHERE u.url LIKE ?').get(pageUrl)?.n??0);
    let completedHttpDownloadRows=0,nativeRoundDownloadRows=0,nativeCompletedDownloadRows=0;
    if(tableNames.has('downloads')&&tableNames.has('downloads_url_chains')){
      allDownloadRows=Number(db.prepare('SELECT COUNT(*) AS n FROM downloads').get()?.n??0);
      downloadRows=Number(db.prepare('SELECT COUNT(DISTINCT d.id) AS n FROM downloads d JOIN downloads_url_chains c ON c.id = d.id WHERE c.url LIKE ?').get(`${baseUrl}/download/%`)?.n??0);
      completedHttpDownloadRows=Number(db.prepare("SELECT COUNT(DISTINCT d.id) AS n FROM downloads d JOIN downloads_url_chains c ON c.id = d.id WHERE d.state = 1 AND c.url LIKE ? AND (c.url LIKE '%/download/txt%' OR c.url LIKE '%/download/exe%')").get(`${baseUrl}/download/%`)?.n??0);
      nativeCompletedDownloadRows=Number(db.prepare('SELECT COUNT(*) AS n FROM downloads WHERE state = 1').get()?.n??0);
      if(round!==null)nativeRoundDownloadRows=Number(db.prepare('SELECT COUNT(DISTINCT d.id) AS n FROM downloads d JOIN downloads_url_chains c ON c.id = d.id WHERE c.url LIKE ?').get(`${baseUrl}/download/%?round=${round}`)?.n??0);
    }
    if(tableNames.has('downloads_url_chains'))chains=Number(db.prepare('SELECT COUNT(*) AS n FROM downloads_url_chains WHERE url LIKE ?').get(`${baseUrl}/download/%`)?.n??0);
    if(tableNames.has('downloads_slices'))slices=Number(db.prepare('SELECT COUNT(*) AS n FROM downloads_slices').get()?.n??0);
    const backupDownloadTables=[...tableNames].filter(name=>/^k_download_history_backup_[a-f0-9]+_downloads$/.test(name));
    const backupDownloadRows=backupDownloadTables.reduce((sum,name)=>sum+Number(db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get()?.n??0),0);
    const backupChainTables=[...tableNames].filter(name=>/^k_download_history_backup_[a-f0-9]+_url_chains$/.test(name));
    const backupChainRows=backupChainTables.reduce((sum,name)=>sum+Number(db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get()?.n??0),0);
    const backupSliceTables=[...tableNames].filter(name=>/^k_download_history_backup_[a-f0-9]+_slices$/.test(name));
    const backupSliceRows=backupSliceTables.reduce((sum,name)=>sum+Number(db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get()?.n??0),0);
    let backupCompletedHttpDownloadRows=0;
    for(const table of backupDownloadTables){
      const batch=table.match(/^k_download_history_backup_([a-f0-9]+)_downloads$/)?.[1];
      const chainTable=`k_download_history_backup_${batch}_url_chains`;
      if(batch&&tableNames.has(chainTable))backupCompletedHttpDownloadRows+=Number(db.prepare(`SELECT COUNT(DISTINCT d.id) AS n FROM "${table}" d JOIN "${chainTable}" c ON c.id = d.id WHERE d.state = 1 AND c.url LIKE ? AND (c.url LIKE '%/download/txt%' OR c.url LIKE '%/download/exe%')`).get(`${baseUrl}/download/%`)?.n??0);
    }
    const managedBackupBatches=tableNames.has('k_download_history_batches')?Number(db.prepare('SELECT COUNT(*) AS n FROM k_download_history_batches').get().n):0;
    const seenFingerprints=tableNames.has('k_download_history_seen')?Number(db.prepare('SELECT COUNT(*) AS n FROM k_download_history_seen').get().n):0;
    const retainedCompletedHttpDownloadRows=backupCompletedHttpDownloadRows+completedHttpDownloadRows;
    const retainedDownloadRows=backupDownloadRows+allDownloadRows;
    return {available:true,urlRows,visits,nativeDownloadRows:downloadRows,nativeRoundDownloadRows,nativeCompletedDownloadRows,completedHttpDownloadRows,backupDownloadRows,backupChainRows,backupSliceRows,backupCompletedHttpDownloadRows,backupBatches:backupDownloadTables.length,managedBackupBatches,seenFingerprints,retainedCompletedHttpDownloadRows,retainedDownloadRows,chains,slices};
  }finally{db.close();}
}

async function launchRound(root,round,baseUrl){
  const recordFile=`round-${round}.json`;
  const key=path.basename(root);
  const sessionRoot=path.join(root,'.runtime','browser-profiles',key);
  const outputRoot=path.join(root,'downloads');
  await mkdir(sessionRoot,{recursive:true});
  await mkdir(outputRoot,{recursive:true});
  let live;
  let context;
  const evidence={round,channel,startedAt:new Date().toISOString(),baseUrl,checks:{},downloads:[],events:[],errors:[]};
  const fakeState={threadId:'persistent-download-probe',browserAccess:{enabled:true,sessionKey:key}};
  const route=(name,body)=>browserLiveRequest(root,fakeState,fakeState.threadId,name,body);
  const event=(name,data={})=>evidence.events.push({name,at:new Date().toISOString(),...data});
  const pageInfo=()=>context.pages().find(page=>!page.isClosed());
  try{
    live=await createBrowserLiveSession(sessionRoot,{
      downloadDirectory:outputRoot,
      launchContext:(userDataDir,viewport)=>chromium.launchPersistentContext(userDataDir,{channel,headless:true,viewport}),
    });
    context=await live.contextGetter();
    evidence.browserVersion=context.browser()?.version()??null;
    const page=pageInfo()??await context.newPage();
    if(round===0){
      await page.goto(`${baseUrl}/signin`,{waitUntil:'domcontentloaded'});
      await page.evaluate(async()=>{
        localStorage.setItem('k_fake_local','persistent-only');
        await new Promise((resolve,reject)=>{
          const request=indexedDB.open('k_fake_db',1);
          request.onupgradeneeded=()=>request.result.createObjectStore('state');
          request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{const db=request.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put('persistent-only','marker');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
        });
      });
      const cookies=await context.cookies(baseUrl);
      evidence.checks.signinCookieSeeded=cookies.some(cookie=>cookie.name==='k_fake_session'&&cookie.value==='synthetic-session-only');
      event('fake-signin-seeded',{cookie:evidence.checks.signinCookieSeeded,localStorage:true,indexedDB:true});
    }else{
      await page.goto(`${baseUrl}/check?round=${round}`,{waitUntil:'domcontentloaded'});
      const check=await page.evaluate(async()=>{
        const local=localStorage.getItem('k_fake_local');
        const indexed=await new Promise((resolve,reject)=>{
          const request=indexedDB.open('k_fake_db');
          request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('state')){db.close();resolve(null);return;}const get=db.transaction('state').objectStore('state').get('marker');get.onsuccess=()=>{db.close();resolve(get.result??null);};get.onerror=()=>reject(get.error);};
        });
        return {local,indexed,authenticated:document.body.dataset.authenticated==='true'};
      });
      evidence.checks.cookieSent=(await context.cookies(baseUrl)).some(cookie=>cookie.name==='k_fake_session'&&cookie.value==='synthetic-session-only');
      evidence.checks.localStorageRetained=check.local==='persistent-only';
      evidence.checks.indexedDbRetained=check.indexed==='persistent-only';
      evidence.checks.fakeEndpointAuthenticated=check.authenticated;
      event('persistent-state-checked',check);
    }

    await page.goto(`${baseUrl}/check?round=${round}`,{waitUntil:'domcontentloaded'});
    for(const [kind,expected] of [['txt',`synthetic round ${round} plain text`],['exe',`synthetic round ${round} harmless executable-name text`],['blob',`synthetic round ${round} blob text`]]){
      const downloadEvent=page.waitForEvent('download',{timeout:15000});
      if(kind==='blob')await page.locator('#blob').click();
      else await page.locator(`#${kind}`).click();
      const download=await downloadEvent;
      event('download-event',{kind,name:download.suggestedFilename()});
      let state;
      let lastItemState=null;
      for(let attempt=0;attempt<100;attempt++){
        state=await route('/state');
        const matchingRows=state.downloads?.filter(row=>row.name===download.suggestedFilename())??[];
        if(matchingRows.length)lastItemState=matchingRows.at(-1);
        const item=matchingRows.find(row=>row.status==='completed');
        if(item){
          const saved=await route(`/download?id=${item.id}`);
          const file=path.join(outputRoot,item.id,item.name);
          const bytes=await readFile(file);
          const zone=process.platform==='win32'?await readFile(`${file}:Zone.Identifier`,'utf8'):null;
          const verified={kind,name:item.name,id:item.id,bodyMatches:bytes.toString('utf8')===expected,downloadEndpointMatches:saved.bytes.toString('utf8')===expected,zoneMarked:process.platform==='win32'?zone==='[ZoneTransfer]\r\nZoneId=3\r\n':'unsupported',size:bytes.length,file};
          evidence.downloads.push(verified);
          assert(verified.bodyMatches&&verified.downloadEndpointMatches,'Saved synthetic download bytes did not match.');
          if(process.platform==='win32')assert(verified.zoneMarked,'Saved file Zone.Identifier was missing or incorrect.');
          break;
        }
        await delay(100);
      }
      if(lastItemState)evidence.events.push({name:'download-final-state',kind,...lastItemState});
      assert(evidence.downloads.some(row=>row.kind===kind),'Download was not safely saved by K live session.');
    }

    // A deliberately unfinished local transfer is canceled; it must fail only
    // that item, leave the live browser usable, and not stop later navigation.
    const beforeCancel={url:page.url(),slowLinks:await page.locator('#slow').count()};
    event('before-unfinished-download',beforeCancel);
    const cancelFailurePromise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Canceled download event was not observed.')),15000);
      page.once('download',download=>{
        clearTimeout(timer);
        void download.cancel().then(()=>download.failure()).then(resolve,reject);
      });
    });
    await page.locator('#slow').click({timeout:10000,noWaitAfter:true});
    const cancelFailure=await cancelFailurePromise;
    event('unfinished-download-canceled',{failure:cancelFailure});
    evidence.checks.cancelObserved=cancelFailure!==null;
    await page.goto(`${baseUrl}/check?round=${round}`,{waitUntil:'domcontentloaded'});
    evidence.checks.navigationAfterCancel=page.url()===`${baseUrl}/check?round=${round}`&&!page.isClosed();

    const stateBefore=await route('/state');
    const canceledName=`round-${round}-cancel.txt`;
    const failedBefore=stateBefore.downloads.filter(item=>item.status==='failed');
    evidence.checks.onlyCanceledDownloadFailed=failedBefore.length===1&&failedBefore[0].name===canceledName&&Boolean(failedBefore[0].error);
    evidence.checks.sessionAvailable=stateBefore.available===true;
    evidence.checks.idleAndNotBusy=stateBefore.busy===false;
    evidence.checks.onlyLocalUrl=stateBefore.url.startsWith(baseUrl);
    const takeover=await route('/action',{type:'takeover'});
    const lockBlocked=!live.beginAiCall();
    const fixturePageId=stateBefore.pages.find(item=>item.url.startsWith(baseUrl))?.id;
    assert(fixturePageId,'The local fixture tab was not available for human takeover.');
    await route('/action',{type:'selectPage',pageId:fixturePageId});
    evidence.humanInputTarget=await page.evaluate(()=>({atPoint:document.elementFromPoint(80,30)?.outerHTML??null,rect:(()=>{const r=document.querySelector('#note').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})(),viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY}}));
    evidence.humanClickState=await route('/action',{type:'click',pageId:fixturePageId,x:80,y:30});
    evidence.humanTextState=await route('/action',{type:'text',pageId:fixturePageId,text:`human-input-round-${round}`});
    const humanValue=await page.locator('#note').inputValue();
    evidence.checks.humanInputFocused=await page.evaluate(()=>document.activeElement?.id==='note');
    const stateHuman=await route('/state');
    const failedInHumanSnapshot=stateHuman.downloads.filter(item=>item.status==='failed');
    evidence.downloadSnapshotDuringTakeover={mode:stateHuman.mode,failedDownloadCount:failedInHumanSnapshot.length,failedDownloads:failedInHumanSnapshot.map(({name,error})=>({name,error}))};
    const released=await route('/action',{type:'release'});
    const lockRestored=live.beginAiCall();
    if(lockRestored)live.endAiCall();
    evidence.checks.takeoverMode=takeover.mode==='human'&&takeover.busy===false;
    evidence.checks.aiLockedDuringTakeover=lockBlocked;
    evidence.checks.humanInputAccepted=humanValue===`human-input-round-${round}`;
    evidence.checks.releaseMode=released.mode==='ai'&&released.busy===false&&stateHuman.mode==='human';
    evidence.checks.failureVisibleInHumanSnapshot=failedInHumanSnapshot.length===1&&failedInHumanSnapshot[0].name===canceledName&&Boolean(failedInHumanSnapshot[0].error);
    evidence.checks.aiLockRestoredAfterRelease=lockRestored;
    const finalState=await route('/state');
    evidence.checks.finalAvailable=finalState.available===true;
    evidence.checks.finalNotBusy=finalState.busy===false;
    event('handoff-check',{takeoverMode:takeover.mode,humanInput:humanValue,releaseMode:released.mode,aiLockBlocked:lockBlocked,aiLockRestored:lockRestored});

  }catch(error){
    evidence.errors.push(error?.stack??String(error));
  }finally{
    await live?.close().catch(error=>evidence.errors.push(`close: ${error.message}`));
    evidence.history=await historyReadback(sessionRoot,baseUrl,round);
    evidence.checks.historyReadback=evidence.history.available===true;
    evidence.checks.fakePageHistoryRetained=evidence.checks.historyReadback&&evidence.history.urlRows>=1&&evidence.history.visits>=1;
    evidence.checks.downloadHistoryPresent=evidence.checks.historyReadback&&evidence.history.retainedCompletedHttpDownloadRows>=2*Math.min(round+1,6);
    evidence.checks.currentRoundNativeHistory=evidence.checks.historyReadback&&evidence.history.nativeRoundDownloadRows>=3;
    evidence.checks.historyArchiveReadback=evidence.checks.historyReadback&&evidence.history.retainedDownloadRows>=3*Math.min(round+1,6);
    evidence.passed=evidence.errors.length===0&&Object.values(evidence.checks).every(Boolean)&&evidence.downloads.length===3;
    evidence.endedAt=new Date().toISOString();
    await writeFile(path.join(root,recordFile),JSON.stringify(evidence,null,2),{flag:'wx'});
  }
  return evidence;
}

if(childArg>=0){
  const root=path.resolve(process.argv[childArg+1]??'');
  const round=Number(process.argv[childArg+2]);
  const baseUrl=process.argv[childArg+3];
  const recordFile=`round-${round}.json`;
  if(!root.startsWith(probeRoot+path.sep)||!Number.isInteger(round)||round<0||!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl??''))throw new Error('Invalid child probe arguments.');
  const result=await launchRound(root,round,baseUrl);
  console.log(JSON.stringify({round:result.round,passed:result.passed,checks:result.checks,history:result.history,errors:result.errors.map(error=>error.split('\n')[0])}));
  process.exitCode=result.passed?0:1;
}else{
  const root=path.join(probeRoot,randomUUID());
  const profile=path.join(root,'.runtime','browser-profiles',path.basename(root));
  const requests=[];
  const slowResponses=new Set();
  const contents=round=>({
    txt:`synthetic round ${round} plain text`,
    exe:`synthetic round ${round} harmless executable-name text`,
    blob:`synthetic round ${round} blob text`,
  });
  const html=(round,authenticated)=>`<!doctype html><title>local persistent-download fixture</title><body data-authenticated="${authenticated}"><label for="note">Note</label><input id="note" value="" style="position:fixed;left:20px;top:20px;width:400px;height:40px;z-index:10"><p>Synthetic local-only test.</p><p><a id="txt" href="/download/txt?round=${round}">text</a></p><p><a id="exe" href="/download/exe?round=${round}">harmless exe-name text</a></p><p><a id="blob" href="#" download="round-${round}.blob.txt">blob</a></p><p><a id="slow" href="/download/slow?round=${round}">cancel slow</a></p><script>document.querySelector('#blob').addEventListener('click',e=>{e.preventDefault();const b=new Blob([${JSON.stringify(contents(round).blob)}],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='round-${round}.blob.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});</script></body>`;
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    const fakeCookie=(req.headers.cookie??'').includes('k_fake_session=synthetic-session-only');
    requests.push({method:req.method,url:url.pathname+url.search,remote:req.socket.remoteAddress,cookiePresent:fakeCookie});
    if(url.pathname==='/signin'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Set-Cookie':'k_fake_session=synthetic-session-only; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax'});
      res.end('<!doctype html><title>fake sign-in</title><body>Fake local sign-in only.</body>');return;
    }
    if(url.pathname==='/check'){
      const round=Number(url.searchParams.get('round')??'0');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      res.end(html(round,fakeCookie));return;
    }
    const match=/^\/download\/(txt|exe|slow)$/.exec(url.pathname);
    if(match){
      const round=Number(url.searchParams.get('round')??'0');
      if(match[1]==='slow'){
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="round-${round}-cancel.txt"`,'Content-Length':'1048576'});
        res.write('x'.repeat(2048));slowResponses.add(res);res.on('close',()=>slowResponses.delete(res));return;
      }
      const kind=match[1],body=Buffer.from(contents(round)[kind]);
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="round-${round}.${kind==='exe'?'exe':'txt'}"`,'Content-Length':body.length});
      res.end(body);return;
    }
    res.writeHead(404);res.end();
  });
  await mkdir(root,{recursive:true});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const allRounds=[];
  const logs=[];
  const runRound=async round=>{
    const child=spawn(process.execPath,[scriptPath,'--run','--child',root,String(round),baseUrl,...(chromiumMode?['--chromium']:[])],{cwd:projectRoot,windowsHide:true,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:chromiumMode?projectBrowsers:process.env.PLAYWRIGHT_BROWSERS_PATH}});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
    const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
    await writeFile(path.join(root,`round-${round}.log`),output,{flag:'wx'});
    let evidence;
    try{evidence=JSON.parse(await readFile(path.join(root,`round-${round}.json`),'utf8'));}
    catch(error){throw new Error(`Child round ${round} exited ${exitCode} without evidence: ${output.slice(-3000)} (${error.message})`);}
    allRounds.push(evidence);logs.push({round,exitCode,passed:evidence.passed,checks:evidence.checks,history:evidence.history,errors:evidence.errors.map(error=>error.split('\n')[0])});
    return evidence;
  };
  try{
    for(let round=0;round<roundCount;round++){
      const result=await runRound(round);
      if(!result.passed)break;
    }
  }finally{
    for(const response of slowResponses)response.destroy();
    server.closeAllConnections?.();
    await new Promise(resolve=>server.close(()=>resolve()));
  }
  const savedFileChecks=[];
  for(const round of allRounds)for(const item of round.downloads){
    try{
      const bytes=await readFile(item.file);
      const zone=process.platform==='win32'?await readFile(`${item.file}:Zone.Identifier`,'utf8'):null;
      savedFileChecks.push({round:round.round,kind:item.kind,stillPresent:bytes.length===item.size&&bytes.toString('utf8').includes(`synthetic round ${round.round}`),zoneMarked:process.platform==='win32'?zone==='[ZoneTransfer]\r\nZoneId=3\r\n':'unsupported'});
    }catch(error){savedFileChecks.push({round:round.round,kind:item.kind,stillPresent:false,error:error.message});}
  }
  const historyFinal=await historyReadback(profile,baseUrl,roundCount-1);
  const visitsMonotonic=allRounds.every((item,index)=>index===0||item.history?.visits>=allRounds[index-1].history?.visits);
  const checkRequests=requests.filter(item=>item.url.startsWith('/check?round='));
  const backupRetentionPassed=allRounds.every((item,index)=>item.history.managedBackupBatches===Math.min(index,5));
  const result={evidencePath:path.join(root,'summary.json'),root,baseUrl,rounds:logs,savedFileChecks,historyFinal,backupRetentionPassed,visitsMonotonic,onlyLoopback:requests.every(item=>isLoopback(item.remote)),fakeCookieSubsequentRounds:checkRequests.length>=roundCount&&checkRequests.every(item=>item.cookiePresent),requestCount:requests.length,passed:allRounds.length===roundCount&&allRounds.every(item=>item.passed)&&savedFileChecks.length===3*roundCount&&savedFileChecks.every(item=>item.stillPresent&&(process.platform!=='win32'||item.zoneMarked))&&historyFinal.available===true&&historyFinal.nativeRoundDownloadRows>=3&&historyFinal.retainedCompletedHttpDownloadRows>=2*Math.min(roundCount,6)&&historyFinal.retainedDownloadRows>=3*Math.min(roundCount,6)&&backupRetentionPassed&&visitsMonotonic&&checkRequests.length>=roundCount&&checkRequests.every(item=>item.cookiePresent)&&requests.every(item=>isLoopback(item.remote))};
  await writeFile(path.join(root,'summary.json'),JSON.stringify({...result,requests},null,2),{flag:'wx'});
  console.log(JSON.stringify(result,null,2));
  if(!result.passed)process.exitCode=1;
}
