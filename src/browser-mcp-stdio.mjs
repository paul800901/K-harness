import {createConnection} from '@playwright/mcp';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {randomUUID} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// This is a tool-level boundary, not an OS sandbox. Keep the official browser
// implementation, but do not allow native clients' project roots to widen it.
export async function validateBrowserFiles(directory,paths){
  if(!Array.isArray(paths))throw new Error('File paths must be an array.');
  const root=await realpath(directory);
  for(const file of paths){
    if(typeof file!=='string')throw new Error('Invalid file path.');
    const target=await realpath(path.resolve(root,file));
    const relative=path.relative(root,target);
    if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('File access denied: outside this conversation browser directory.');
  }
}

export function restrictedBrowserTransport(raw,directory,liveSession=null){
  const lists=new Set();
  const activeCalls=new Set();
  const cancelledCalls=new Set();
  const dataNavigations=new Set();
  const pendingDataNavigations=new Set();
  const pendingReloads=new Set();
  const tabListings=new Set();
  const internalTabLists=new Map();
  const suppressedInternalTabLists=new Set();
  const releaseCall=id=>{
    if(activeCalls.delete(id))liveSession?.endAiCall();
    if(!pendingDataNavigations.has(id)&&!pendingReloads.has(id)&&!tabListings.has(id))cancelledCalls.delete(id);
  };
  const deny=message=>{
    if(activeCalls.delete(message.id))liveSession?.endAiCall();
    return raw.send({jsonrpc:'2.0',id:message.id,result:{isError:true,content:[{type:'text',text:'Browser operation denied: '+message.reason}]}});
  };
  return {
    async start(){
      raw.onclose=()=>{this.onclose?.();void liveSession?.close();};raw.onerror=e=>this.onerror?.(e);
      raw.onmessage=async message=>{
        try{
          if(message.method==='notifications/cancelled'){
            const requestId=message.params?.requestId;
            if(activeCalls.has(requestId)&&liveSession){
              // Cancellation is only a request to stop. Playwright tools may
              // ignore their abort signal, so close the whole browser session
              // before releasing the AI-call lock or allowing takeover.
              cancelledCalls.add(requestId);
              for(const [internalId,request] of internalTabLists){
                if(request.parentId!==requestId)continue;
                internalTabLists.delete(internalId);suppressedInternalTabLists.add(internalId);
                request.reject(new Error('Browser reload was cancelled.'));
              }
              void liveSession.failClosed().then(()=>{
                if(cancelledCalls.has(requestId))releaseCall(requestId);
              }).catch(error=>this.onerror?.(error));
            }
            this.onmessage?.(message);
            return;
          }
          if(message.method==='tools/list')lists.add(message.id);
          if(message.method==='tools/call'){
            const name=message.params?.name,args=message.params?.arguments??{};
            if(liveSession&&!liveSession.beginAiCall())return await deny({...message,reason:'browser is in human-control mode or unavailable.'});
            if(liveSession)activeCalls.add(message.id);
            // Upstream explicitly exempts code-origin file accesses from its
            // workspace guard; do not expose that escape hatch in K.
            if(name==='browser_run_code_unsafe')return await deny({...message,reason:'arbitrary browser code is not enabled in K.'});
            if(['browser_file_upload','browser_drop'].includes(name)&&args.paths!==undefined)await validateBrowserFiles(directory,args.paths);
            if(name==='browser_tabs'&&args.action==='list')tabListings.add(message.id);
            if(name==='browser_reload'&&liveSession?.reloadPageAtIndex){
              pendingReloads.add(message.id);
              try{
                const internalId=`k-browser-reload-${randomUUID()}`;
                const currentIndex=await new Promise((resolve,reject)=>{
                  internalTabLists.set(internalId,{parentId:message.id,resolve,reject});
                  this.onmessage?.({jsonrpc:'2.0',id:internalId,method:'tools/call',params:{name:'browser_tabs',arguments:{action:'list'}}});
                });
                if(!Number.isInteger(currentIndex)||currentIndex<0)throw new Error('The selected browser tab could not be identified.');
                await liveSession.reloadPageAtIndex(currentIndex);
              }
              finally{pendingReloads.delete(message.id);}
              if(cancelledCalls.has(message.id)){
                if(!activeCalls.has(message.id))cancelledCalls.delete(message.id);
                return;
              }
              return await this.send({jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:'Reloaded the selected browser page using browser navigation. The same tab remains selected.'}]}});
            }
            if(name==='browser_navigate'&&typeof args.url==='string'&&/^data:/iu.test(args.url)&&liveSession?.openDataPage){
              pendingDataNavigations.add(message.id);
              let index;
              try{index=await liveSession.openDataPage(args.url);}
              finally{pendingDataNavigations.delete(message.id);}
              if(cancelledCalls.has(message.id)){
                if(!activeCalls.has(message.id))cancelledCalls.delete(message.id);
                return;
              }
              if(index!==null){
                if(!Number.isInteger(index)||index<0)throw new Error('The data page did not become available.');
                dataNavigations.add(message.id);
                message={...message,params:{name:'browser_tabs',arguments:{action:'select',index}}};
              }
            }
          }
          this.onmessage?.(message);
      }catch(e){
        if(cancelledCalls.has(message.id)){
          if(!activeCalls.has(message.id))cancelledCalls.delete(message.id);
          return;
        }
        if(message.method==='tools/call')await deny({...message,reason:e.message});else this.onerror?.(e);
      }
      };
      await raw.start();
    },
      async send(message){
      if(dataNavigations.delete(message.id)&&message.result?.content)message={...message,result:{...message.result,content:[{type:'text',text:'The data URL was opened in a new tab in the selected browser mode. The previous tab is unchanged.'},...message.result.content]}};
      if(internalTabLists.has(message.id)){
        const query=internalTabLists.get(message.id);internalTabLists.delete(message.id);
        const body=(message.result?.content??[]).filter(item=>item.type==='text').map(item=>item.text).join('\n');
        const selected=/^- (\d+): \(current\) /m.exec(body);
        if(message.result?.isError||!selected)query.reject(new Error('The selected browser tab could not be identified.'));
        else query.resolve(Number(selected[1]));
        return;
      }
      if(suppressedInternalTabLists.delete(message.id))return;
      if(lists.delete(message.id)&&message.result?.tools)message={...message,result:{...message.result,tools:[...message.result.tools.filter(t=>t.name!=='browser_run_code_unsafe').map(t=>{
        if(t.name==='browser_resize')return {...t,description:t.description+' K automatically fits the right-side browser view to its panel. Choose the task viewport here; users do not need to adjust technical display settings.'};
        if(t.name==='browser_evaluate')return {...t,description:t.description+' For task-specific page layout zoom, use document.documentElement.style.zoom (for example "0.8", or "1" to reset). This is current-document CSS zoom, not saved browser preferences; navigation may reset it. Reinspect the page after changing zoom. Human takeover blocks this tool like all other browser tools.'};
        if(t.name==='browser_tabs')return {...t,description:t.description+' K panel tabs are previews, not the AI active-tab selector. Always select the intended AI tab explicitly before acting; do not assume a human preview-tab switch changed your target.'};
        if(t.name==='browser_navigate')return {...t,description:t.description+' In external Chrome, data: URLs open and select a new tab; the previous tab is preserved.'};
        if(t.name==='browser_take_screenshot')return {...t,
          description:'Capture the selected page. Without a filename, the image is returned inline and saved in this conversation and selected browser mode output directory. With a filename, a file reference is returned. Relative filenames resolve from the MCP client working directory; in formal K this is the same conversation and selected browser mode output directory, not the project workspace. K does not move the image.',
          inputSchema:{...t.inputSchema,properties:{...t.inputSchema?.properties,filename:{...t.inputSchema?.properties?.filename,description:'Optional name. If omitted, an automatic page-{timestamp} image is returned inline and saved in this conversation and selected browser mode output directory. If provided, relative filenames resolve from the MCP client working directory. In formal K this is the same conversation and selected browser mode output directory, not the project workspace. Use the returned file reference as the actual location.'}}}};
        return t;
      }),...(message.result.tools.some(t=>t.name==='browser_reload')?[]:[{name:'browser_reload',title:'Reload the selected page',description:'Reload the currently selected browser tab with browser navigation. This keeps the same tab selected.',inputSchema:{type:'object',properties:{},additionalProperties:false}}])]}};
      if(message.result?.content?.some(item=>item.type==='text'&&/^\- \d+: (?:\(current\) )?\[/m.test(item.text))&&liveSession?.getState){
        const state=await liveSession.getState();
        const pages=state.pages??[];
        message={...message,result:{...message.result,content:message.result.content.map(item=>{
          if(item.type!=='text'||typeof item.text!=='string')return item;
          const text=item.text.split('\n').map(line=>{
            const row=/^(- (\d+):)( \(current\))? \[(.*)\]\((.*)\)( \[crashed\])?$/.exec(line);
            if(!row)return line;
            const page=pages[Number(row[2])];
            if(!page||page.url!==row[5]||typeof page.title!=='string')return line;
            const title=page.title.replaceAll('\\','\\\\').replaceAll('[','\\[').replaceAll(']','\\]');
            return `${row[1]}${row[3]??''} [${title}](${row[5]})${row[6]??''}`;
          }).join('\n');
          return {...item,text};
        })}};
      }
      if(cancelledCalls.has(message.id)){
        tabListings.delete(message.id);
        if(!activeCalls.has(message.id))cancelledCalls.delete(message.id);
        return;
      }
      if(activeCalls.has(message.id))releaseCall(message.id);
      tabListings.delete(message.id);
      return raw.send(message);
    },
    async close(){await raw.close();}
  };
}

export async function startBrowserMcp(directory,profile){
  if(!path.isAbsolute(directory??'')||!path.isAbsolute(profile??''))throw new Error('Dedicated absolute browser directories are required.');
  const root=await realpath(directory);
  process.chdir(root); // Claude does not support the Codex MCP cwd field.
  const {createBrowserLiveSession}=await import('./browser-live-session.mjs');
  const liveSession=await createBrowserLiveSession(profile,{downloadDirectory:path.join(root,'downloads')});
  let server;
  try{
  server=await createConnection({browser:{browserName:'chromium',userDataDir:profile,launchOptions:{channel:'msedge',headless:true,viewport:{width:1024,height:768}}},outputDir:root,allowUnrestrictedFileAccess:false,webmcp:false},liveSession.contextGetter);
  // The public SDK method is used by Playwright during initialization. Return
  // only K's dedicated directory, regardless of provider roots capabilities.
  server.listRoots=async()=>({roots:[{uri:pathToFileURL(root).href,name:'K browser files'}]});
  const transport=restrictedBrowserTransport(new StdioServerTransport(),root,liveSession);
  // The SDK transport does not close itself on stdin EOF. Without this, the
  // live-view HTTP listener keeps the process alive until the native client
  // kills it, which can lose unflushed persistent cookies/history on Windows.
  const onInputEnd=()=>{void server.close().catch(error=>console.error(error.message));};
  const close=transport.close.bind(transport);
  transport.close=async()=>{process.stdin.off('end',onInputEnd);try{await close();}finally{await liveSession.close();}};
  await server.connect(transport);
  process.stdin.once('end',onInputEnd);
  return server;
  }catch(error){await liveSession.close();throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  startBrowserMcp(process.argv[2],process.argv[3]).catch(error=>{console.error(error.message);process.exitCode=1;});
}

