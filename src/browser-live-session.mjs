import {randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {MAX_DOWNLOAD_COPY_BYTES} from '../shared/browser-downloads.mjs';

const VIEWPORT={width:1024,height:768};
/**
 * One externally supplied browser context shared by the official Playwright
 * MCP server and K's authenticated live-view controls. This is a local control
 * API, not an OS/browser isolation boundary.
 */
export async function createBrowserLiveSession(profile,{launchContext,downloadDirectory,onControlChange=()=>{}}={}){
  if(typeof profile!=='string'||!path.isAbsolute(profile))throw new Error('Dedicated absolute browser profile is required.');
  if(downloadDirectory!==undefined&&(typeof downloadDirectory!=='string'||!path.isAbsolute(downloadDirectory)))throw new Error('Dedicated absolute download directory is required.');
  if(typeof onControlChange!=='function')throw new TypeError('onControlChange must be a synchronous callback.');
  const downloadsRoot=downloadDirectory?path.resolve(downloadDirectory):null;
  let contextPromise;
  let context=null;
  let mode='ai', aiCalls=0, humanAction=false, disconnected=false, closed=false;
  let nextPageId=1, selectedPageId=null, failClosedPromise=null, closePromise=null;
  let humanInputAllowed=false;
  const pageIds=new WeakMap();
  const downloadPages=new WeakSet();
  const downloads=new Map();
  const downloadFiles=new Map();
  const saveTargets=new Set();
  const pageId=page=>{let id=pageIds.get(page);if(!id){id=`page-${nextPageId++}`;pageIds.set(page,id);}return id;};
  const controlSnapshot=({mode:nextMode=mode,aiCalls:nextAiCalls=aiCalls,humanAction:nextHumanAction=humanAction,closed:nextClosed=closed,disconnected:nextDisconnected=disconnected}={})=>({
    mode:nextMode,aiCalls:nextAiCalls,busy:nextAiCalls>0||nextHumanAction,
    available:!!context&&!nextDisconnected&&!nextClosed,selectedPageId,
    humanInputAllowed:!!context&&nextMode==='human'&&nextAiCalls===0&&!nextHumanAction&&!nextDisconnected&&!nextClosed,
  });
  const notifyControl=(next={})=>{
    const snapshot=controlSnapshot(next);
    try{
      const result=onControlChange(snapshot);
      if(result&&typeof result.then==='function'){
        void Promise.resolve(result).catch(()=>{});
        throw new Error('Native browser control callback must be synchronous.');
      }
      humanInputAllowed=snapshot.humanInputAllowed;
      return true;
    }catch{
      humanInputAllowed=false;
      return false;
    }
  };
  const installSafeSaveAs=download=>{
    if(download.__kSafeSaveAsInstalled)return;
    const originalSaveAs=download.saveAs;
    if(typeof originalSaveAs!=='function')throw new Error('Download save operation is unavailable.');
    const allowedRoot=downloadsRoot?path.dirname(downloadsRoot):null;
    const safeSaveAs=async destination=>{
      if(!allowedRoot)throw new Error('Download saving is not enabled for this session.');
      if(typeof destination!=='string'||!destination)throw new Error('Download destination is invalid.');
      const target=path.resolve(destination), relative=path.relative(allowedRoot,target);
      if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('Download destination is outside the session output directory.');
      if(saveTargets.has(target))throw new Error('Download destination is already being saved.');
      saveTargets.add(target);
      try{
        await ensureSafeDirectory(path.dirname(target));
        await verifySafeDirectory(allowedRoot);
        try{await lstat(target);throw new Error('Download destination already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
        await originalSaveAs.call(download,target);
        await verifySafeDirectory(path.dirname(target));
        const fileInfo=await lstat(target);
        if(fileInfo.isSymbolicLink()||!fileInfo.isFile())throw new Error('Unsafe download destination.');
        if(process.platform==='win32'){
          const marker='[ZoneTransfer]\r\nZoneId=3\r\n';
          await writeFile(`${target}:Zone.Identifier`,marker,{encoding:'utf8',flag:'w'});
          const readback=await readFile(`${target}:Zone.Identifier`,'utf8');
          if(readback!==marker)throw new Error('Download security marker could not be verified.');
        }
        return;
      }finally{saveTargets.delete(target);}
    };
    download.saveAs=safeSaveAs;
    if(download.saveAs!==safeSaveAs)throw new Error('Download save operation could not be secured.');
    Object.defineProperty(download,'__kSafeSaveAsInstalled',{value:true,configurable:false});
  };
  const attachPage=page=>{
    pageId(page);
    if(typeof page?.on==='function'&&!downloadPages.has(page)){
      downloadPages.add(page);page.on('download',download=>{try{installSafeSaveAs(download);}catch{try{download.saveAs=async()=>{throw new Error('Download save operation could not be secured.');};}catch{}}void trackDownload(download);});
    }
  };
  const getContext=async()=>{
    if(disconnected||closed)throw new Error('Browser session is unavailable.');
    if(!contextPromise)contextPromise=Promise.resolve().then(async()=>{
      return launchContext(profile,VIEWPORT);
    }).then(async value=>{
      if(closed){await value.close().catch(()=>{});throw new Error('Browser session is unavailable.');}
      context=value;
      value.on?.('close',()=>{disconnected=true;mode='human';notifyControl();});
      value.on?.('page',attachPage);
      for(const page of value.pages?.()??[])attachPage(page);
      return value;
    }).catch(error=>{contextPromise=null;disconnected=true;mode='human';notifyControl();throw error;});
    return contextPromise;
  };
  const safeName=value=>{
    const leaf=path.basename(String(value??'download').replaceAll('\\','/'));
    let safe=leaf.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').trim().slice(0,180);
    const deviceBase=safe.split('.',1)[0].replace(/[. ]+$/g,'').toUpperCase();
    if(/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceBase))safe=`_${safe}`;
    return safe&&safe!=='.'&&safe!=='..'?safe:'download';
  };
  const safeSource=download=>{
    try{
      const url=new URL(download.url());
      if(!['http:','https:'].includes(url.protocol))return '';
      return url.origin;
    }catch{return '';}
  };
  const dangerousType=name=>/\.(?:exe|msi|msp|com|scr|dll|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|jar|reg|lnk|iso)$/i.test(name);
  const verifySafeDirectory=async directory=>{
    const absolute=path.resolve(directory), parsed=path.parse(absolute);
    let cursor=parsed.root;
    for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){
      cursor=path.join(cursor,part);
      const info=await lstat(cursor);
      if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Download directory contains a link or non-directory component.');
    }
    return absolute;
  };
  const ensureSafeDirectory=async directory=>{
    const absolute=path.resolve(directory), parsed=path.parse(absolute);
    let cursor=parsed.root;
    for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){
      cursor=path.join(cursor,part);
      try{
        const info=await lstat(cursor);
        if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Download directory contains a link or non-directory component.');
      }catch(error){
        if(error.code!=='ENOENT')throw error;
        try{await mkdir(cursor);}catch(createError){if(createError.code!=='EEXIST')throw createError;}
        const info=await lstat(cursor);
        if(info.isSymbolicLink()||!info.isDirectory())throw new Error('Download directory contains a link or non-directory component.');
      }
    }
    return verifySafeDirectory(absolute);
  };
  async function trackDownload(download){
    const id=randomUUID(), name=safeName(await Promise.resolve().then(()=>download.suggestedFilename?.()).catch(()=>''));
    const record={id,name,status:'downloading',sourceUrl:safeSource(download),dangerous:dangerousType(name),zoneMarked:process.platform==='win32'?'pending':'unsupported',size:null,copyAvailable:false};downloads.set(id,record);
    if(!downloadsRoot){record.status='failed';record.error='此工作階段尚未啟用下載保存。';return;}
    try{
      await ensureSafeDirectory(downloadsRoot);
      const folder=path.join(downloadsRoot,id);
      await mkdir(folder);
      const folderInfo=await lstat(folder);
      if(folderInfo.isSymbolicLink()||!folderInfo.isDirectory())throw new Error('Unsafe download destination.');
      const target=path.join(folder,name);
      try{await lstat(target);throw new Error('Download destination already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!download.__kSafeSaveAsInstalled)throw new Error('Download save operation could not be secured.');
      await download.saveAs(target);
      await verifySafeDirectory(downloadsRoot);
      const folderAfter=await lstat(folder), fileInfo=await lstat(target);
      if(folderAfter.isSymbolicLink()||!folderAfter.isDirectory()||fileInfo.isSymbolicLink()||!fileInfo.isFile())throw new Error('Unsafe download destination.');
      record.zoneMarked=process.platform==='win32'?true:'unsupported';
      record.size=fileInfo.size;record.copyAvailable=fileInfo.size<=MAX_DOWNLOAD_COPY_BYTES;
      downloadFiles.set(id,target);record.status='completed';
    }catch{
      record.status='failed';if(process.platform==='win32')record.zoneMarked=false;record.error='下載未能安全保存，請重新確認網站與下載位置。';
    }
  }
  const historyForPage=async target=>{
    try{
      const session=await context.newCDPSession(target);
      try{
        const history=await session.send('Page.getNavigationHistory');
        const index=history.currentIndex;
        return {canGoBack:index>0,canGoForward:index<history.entries.length-1};
      }finally{await session.detach().catch(()=>{});}
    }catch{return {canGoBack:null,canGoForward:null};}
  };
  const pages=()=>{
    const live=(context?.pages?.()??[]).filter(p=>!p.isClosed?.());
    const mapped=live.map(p=>({id:pageId(p),title:'',url:p.url?.()??''}));
    if(!mapped.some(p=>p.id===selectedPageId))selectedPageId=mapped.at(-1)?.id??null;
    return mapped;
  };
  const state=async()=>{
    const current=pages();
    const detailed=await Promise.all(current.map(async item=>{
      const target=context?.pages?.().find(p=>pageId(p)===item.id);
      return {...item,title:target?await target.evaluate(()=>document.title).catch(()=>item.title):item.title,...(target?await historyForPage(target):{canGoBack:null,canGoForward:null})};
    }));
    return {recoveryRequired:closed||disconnected,...(closed||disconnected?{error:'瀏覽器連線已中止。請重新開啟對話以重新連線；先前操作不會自動重送。'}:{}),mode,busy:aiCalls>0||humanAction,available:!!context&&!disconnected&&!closed,url:detailed.find(p=>p.id===selectedPageId)?.url??'',pages:detailed,selectedPageId,downloads:[...downloads.values()].map(({id,name,status,error,sourceUrl,dangerous,zoneMarked,size,copyAvailable})=>({id,name,status,sourceUrl,dangerous,zoneMarked,size,copyAvailable,...(error?{error}:{})}))};
  };
  const choosePage=async id=>{
    await getContext();const page=context.pages().find(p=>!p.isClosed?.()&&pageId(p)===id);
    if(!page)throw new Error('Unknown or closed browser page.');
    selectedPageId=id;return page;
  };
  const reloadPageAtIndex=async index=>{
    if(!Number.isInteger(index)||index<0)throw new Error('Unknown or closed browser page.');
    const ctx=await getContext();
    const live=(ctx.pages?.()??[]).filter(page=>!page.isClosed?.());
    const page=live[index];
    if(!page)throw new Error('Unknown or closed browser page.');
    await page.reload();
  };
  const beginAiCall=()=>{
    if(mode!=='ai'||disconnected||closed)return false;
    if(!notifyControl({aiCalls:aiCalls+1}))return false;
    aiCalls++;return true;
  };
  const endAiCall=()=>{aiCalls=Math.max(0,aiCalls-1);notifyControl();};
  const ensureHuman=()=>{
    if(mode!=='human'||aiCalls||humanAction||disconnected||closed)throw new Error('Human browser input is not currently available.');
  };
  async function action(payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Invalid browser action.');
    const type=payload.type;
    if(disconnected||closed)throw new Error('Browser session is unavailable; reconnect to resume browser control.');
    if(type==='release'){
      if(humanAction)throw new Error('Cannot release while a human action is running.');
      ensureHuman();
      if(!notifyControl({mode:'ai'}))throw new Error('Native browser input could not be locked.');
      mode='ai';return await state();
    }
    if(type==='takeover'){
      mode='human';
      if(aiCalls){notifyControl();return await state();}
      if(humanAction)throw new Error('Human browser input is not currently available.');
      humanAction=true;
      if(!notifyControl()) {humanAction=false;throw new Error('Native browser input gate is unavailable.');}
      try{
        const ctx=await getContext();
        if(!(ctx.pages?.()??[]).some(p=>!p.isClosed?.()))await ctx.newPage();
        const current=pages();selectedPageId=current.at(-1)?.id??null;
      }finally{humanAction=false;notifyControl();}
      return await state();
    }
    ensureHuman();
    // Selection and tab management are intentionally only allowed after takeover.
    humanAction=true;
    if(!notifyControl()) {humanAction=false;throw new Error('Native browser input gate is unavailable.');}
    try{
      const ctx=await getContext();
      let page;
      if(type==='newPage'){
        page=await ctx.newPage();selectedPageId=pageId(page);humanAction=false;return await state();
      }
      if(type==='closePage'){
        page=await choosePage(payload.pageId);
        await page.close();selectedPageId=pages().at(-1)?.id??null;humanAction=false;return await state();
      }
      if(type==='selectPage'){
        await choosePage(payload.pageId);humanAction=false;return await state();
      }
      page=await choosePage(payload.pageId??selectedPageId);
      switch(type){
        case 'back': await page.goBack();break;
        case 'forward': await page.goForward();break;
        case 'reload': await page.reload();break;
        case 'navigate': {
          if(typeof payload.url!=='string')throw new Error('A URL is required.');
          let url;try{url=new URL(payload.url);}catch{throw new Error('Invalid navigation URL.');}
          if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Only credential-free HTTP and HTTPS navigation is allowed.');
          await page.goto(url.href);break;
        }
        case 'click': {
          const viewport=page.viewportSize?.()??VIEWPORT;
          if(!Number.isFinite(payload.x)||!Number.isFinite(payload.y)||payload.x<0||payload.y<0||payload.x>=viewport.width||payload.y>=viewport.height)throw new Error('Click coordinates are outside the browser viewport.');
          await page.mouse.click(payload.x,payload.y);break;
        }
        case 'text':
          if(typeof payload.text!=='string'||payload.text.length>10000)throw new Error('Invalid text input.');
          await page.keyboard.insertText(payload.text);break;
        case 'key':
          if(!['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Space'].includes(payload.key))throw new Error('Unsupported key.');
          await page.keyboard.press(payload.key);break;
        case 'scroll':
          if(!Number.isFinite(payload.deltaY)||Math.abs(payload.deltaY)>5000)throw new Error('Invalid scroll distance.');
          await page.mouse.wheel(0,payload.deltaY);break;
        default: throw new Error('Unsupported browser action.');
      }
      return await state();
    }finally{humanAction=false;notifyControl();}
  }
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  async function controlRequest(method,route,body){
    try{
      const url=new URL(route,'http://localhost');
      if(method==='GET'&&url.pathname==='/state')return json(await state());
      if(method==='GET'&&url.pathname==='/frame'){
        await getContext();const target=url.searchParams.get('pageId')??selectedPageId;
        const page=context.pages().find(p=>!p.isClosed?.()&&pageId(p)===target);
        if(!page)throw new Error('Unknown or closed browser page.');
        return new Response(await page.screenshot({type:'jpeg',quality:70}),{status:200,headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store'}});
      }
      if(method==='GET'&&url.pathname==='/download'){
        const id=url.searchParams.get('id');
        if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('Invalid download id.');
        const record=downloads.get(id), file=downloadFiles.get(id);
        if(!record||record.status!=='completed'||!file||!record.copyAvailable)throw new Error('Download is not complete or is unavailable.');
        let bytes;
        try{
          await verifySafeDirectory(downloadsRoot);
          const folder=path.dirname(file), folderInfo=await lstat(folder), fileInfo=await lstat(file);
          if(path.dirname(folder)!==downloadsRoot||folderInfo.isSymbolicLink()||!folderInfo.isDirectory()||fileInfo.isSymbolicLink()||!fileInfo.isFile())throw new Error('Unsafe path.');
          const fileStat=await stat(file);
          if(fileStat.size>MAX_DOWNLOAD_COPY_BYTES)throw new Error('Download is too large.');
          bytes=await readFile(file);
        }catch{throw new Error('Download is unavailable.');}
        const encodedName=encodeURIComponent(record.name).replace(/['()*!]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
        return new Response(bytes,{status:200,headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename*=UTF-8''${encodedName}`,'Cache-Control':'no-store'}});
      }
      if(method==='POST'&&url.pathname==='/action'){
        const payload=typeof body==='string'?JSON.parse(body):body;
        return json(await action(payload));
      }
      return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
    }catch(error){return json({error:error.message},400);}
  }
  const failClosed=()=>{
    if(!failClosedPromise)failClosedPromise=(async()=>{
      notifyControl({mode:'human',closed:true});
      closed=true;mode='human';
      if(contextPromise)await contextPromise.catch(()=>{});
      if(context)await context.close();
    })();
    return failClosedPromise;
  };
  const getControlSnapshot=()=>({...controlSnapshot(),humanInputAllowed});
  notifyControl();
  return {
    contextGetter:getContext,
    async openDataPage(url){
      const value=await getContext();
      if(!value.openDataPage)return null;
      const page=await value.openDataPage(url);
      return value.pages().indexOf(page);
    },
    beginAiCall,endAiCall,
    reloadPageAtIndex,
    getState:state,getControlSnapshot,
    humanRequest(route,body){return controlRequest(body===undefined?'GET':'POST',route,body);},
    failClosed,
    close(){
      if(!closePromise)closePromise=(async()=>{
        await failClosed().catch(()=>{});
      })();
      return closePromise;
    },
  };
}

export {VIEWPORT as BROWSER_LIVE_VIEWPORT};
