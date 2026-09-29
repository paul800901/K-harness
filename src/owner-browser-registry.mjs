import path from 'node:path';
import {mkdir,realpath} from 'node:fs/promises';
import {createBrowserOwnerGateway} from './browser-owner-gateway.mjs';
import {identifyBrowserServer} from './browser-mcp-config.mjs';
import {consumeBrowserResponse} from './browser-live-proxy.mjs';

// Only the trusted K process constructs this registry. Its human methods and
// owner profile paths never enter a provider MCP configuration.
export function createOwnerBrowserRegistry({vault,outputRoot,gatewayFactory=createBrowserOwnerGateway,testOnly=true,onControlChange=()=>{}}){
  if(!path.isAbsolute(vault??'')||!path.isAbsolute(outputRoot??''))throw Error('Absolute owner browser directories are required.');
  const entries=new Map(),sessions=new Set();
  async function childDirectory(base,key){
    const resolved=await realpath(base);
    const target=path.join(resolved,key);
    await mkdir(target,{recursive:false}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    if((await realpath(target)).toLowerCase()!==target.toLowerCase())throw Error('Browser directory cannot redirect through a link.');
    return target;
  }
  function session(){
    let active=null,changing=false,closing=false,closeOperation=null;
    const controller={
      async config({conversationId,accessMode,provider}){
        if(changing||closing)throw Error('Browser connection is changing.');
        changing=true;
        try{
          await controller.close();
          const modes=provider==='codex'?['workspace-write','auto-review','danger-full-access']:provider==='claude'?['claude-manual','claude-acceptEdits','claude-auto','claude-bypassPermissions','claude-dontAsk']:[];
          if(!modes.includes(accessMode))return null;
          if(!/^[A-Za-z0-9-]{1,100}$/.test(conversationId??''))throw Error('Invalid browser conversation identifier.');
          if(entries.has(conversationId))throw Error('Browser profile is already owned by another conversation connection.');
          const entry={key:conversationId,gateway:null};active=entry;entries.set(entry.key,entry);
          entry.closing=false;
          entry.opening=(async()=>{
            entry.gateway=await gatewayFactory({profile:await childDirectory(vault,entry.key),directory:await childDirectory(outputRoot,entry.key),onControlChange});
            const ai=entry.gateway.aiMcpServer;
            return identifyBrowserServer({url:ai.url,http_headers:{...ai.headers},startup_timeout_sec:30,tool_timeout_sec:120},entry.key);
          })();
          try{
            const server=await entry.opening;
            if(entry.closing||entries.get(entry.key)!==entry)throw Error('Browser owner was closed while opening.');
            return server;
          }catch(error){if(!entry.closing&&entries.get(entry.key)===entry){entries.delete(entry.key);if(active===entry)active=null;}throw error;}
        }finally{changing=false;}
      },
      async close(){
        if(closeOperation)return closeOperation;
        closing=true;
        const entry=active;
        if(entry)entry.closing=true;
        closeOperation=(async()=>{
          try{
            if(entry?.opening)await entry.opening.catch(()=>{});
            await entry?.gateway?.close();
            if(entry&&entries.get(entry.key)===entry)entries.delete(entry.key);
            if(active===entry)active=null;
          }finally{closing=false;closeOperation=null;}
        })();
        return closeOperation;
      },
    };
    sessions.add(controller);return controller;
  }
  async function request(_root,state,threadId,route,body){
    if(!threadId||threadId!==state.threadId)throw Error('對話已切換，請重新開啟瀏覽器分頁。');
    const key=state.browserAccess?.sessionKey;
    if(!state.browserAccess?.enabled||!key)return {available:false,busy:false,mode:'ai',error:'此對話尚未啟用瀏覽器。'};
    const entry=entries.get(key);
    if(!entry?.gateway)return {available:false,busy:false,mode:'ai',recoveryRequired:true,error:'瀏覽器連線已結束，請重新開啟原對話。'};
    const response=await entry.gateway.humanRequest(route,body);
    if(entries.get(key)!==entry)throw Error('瀏覽器連線已變更，結果已捨棄。');
    const result=await consumeBrowserResponse(response,state,threadId,key,route);
    // This UI label is selected by the trusted owner, never by an AI tool.
    return route==='/state'||route==='/action'?{...result,testOnly:testOnly!==false}:result;
  }
  function scopedEntry(state,threadId){
    if(!threadId||threadId!==state.threadId)throw Error('對話已切換，請重新開啟瀏覽器分頁。');
    const key=state.browserAccess?.sessionKey;
    if(!state.browserAccess?.enabled||!key)throw Error('此對話尚未啟用瀏覽器。');
    const entry=entries.get(key);
    if(!entry?.gateway)throw Error('瀏覽器連線已結束，請重新開啟原對話。');
    return {key,entry};
  }
  async function presentation(state,threadId,pageId){
    const {key,entry}=scopedEntry(state,threadId);
    if(typeof entry.gateway.ownerPresentation!=='function')throw Error('Native browser presentation is unavailable.');
    const result=await entry.gateway.ownerPresentation(pageId);
    if(entries.get(key)!==entry)throw Error('瀏覽器連線已變更，結果已捨棄。');
    return result;
  }
  function controlSnapshot(state,threadId){
    const {entry}=scopedEntry(state,threadId);
    if(typeof entry.gateway.getControlSnapshot!=='function')throw Error('Native browser control state is unavailable.');
    return entry.gateway.getControlSnapshot();
  }
  return {session,request,presentation,controlSnapshot,async close(){const results=await Promise.allSettled([...sessions].map(item=>item.close()));const errors=results.filter(x=>x.status==='rejected').map(x=>x.reason);if(errors.length)throw new AggregateError(errors,'Browser shutdown was not confirmed.');}};
}
