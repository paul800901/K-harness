import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createBrowserOwnerGateway} from './browser-owner-gateway.mjs';

const MODES=new Set(['regular','incognito']);
const browserSessionTool={name:'browser_session',description:'Select the isolated regular or incognito external Chrome session before using browser tools. Switching is refused while a browser operation is active or human control is enabled. No automatic fallback is performed.',inputSchema:{type:'object',properties:{mode:{type:'string',enum:['regular','incognito'],description:'External Chrome mode to select.'}},required:['mode'],additionalProperties:false}};

function bearerMatches(header,token){
  if(typeof header!=='string'||!header.startsWith('Bearer '))return false;
  const a=Buffer.from(header.slice(7)),b=Buffer.from(token);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function rpcError(id,code,message){return {jsonrpc:'2.0',id:id??null,error:{code,message}};}
function unpack(text){
  const data=text.split(/\r?\n/u).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean);
  return JSON.parse(data.length?data.join('\n'):text);
}
function pack(response,message){
  return new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`,{status:response.status,headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache'}});
}
function cleanDescription(description=''){
  return description
    .replace(/\s*K automatically fits the right-side browser view to its panel\. Choose the task viewport here; users do not need to adjust technical display settings\./gu,'')
    .replace(/\s*For task-specific page layout zoom, use document\.documentElement\.style\.zoom[\s\S]*?Human takeover blocks this tool like all other browser tools\./gu,'')
    .replace(/\s*K panel tabs are previews[\s\S]*?changed your target\./gu,'')
    .trim();
}
async function makeDir(parent,name){
  const root=await realpath(parent),target=path.join(root,name);
  await mkdir(target,{recursive:false}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  if((await realpath(target)).toLowerCase()!==target.toLowerCase())throw Error('External browser directory cannot redirect through a link.');
  return target;
}

/**
 * Routes browser MCP calls to a deliberately selected, isolated external
 * Chrome context. The provider sees only this gateway's loopback token; child
 * owner tokens and profile paths remain inside the trusted K process.
 */
export async function createExternalBrowserGateway({directory,profile,onControlChange=()=>{},launchExternalContext,childGatewayFactory=createBrowserOwnerGateway,toolTimeoutMs=120000}){
  if(!path.isAbsolute(directory??'')||!path.isAbsolute(profile??''))throw Error('Absolute external browser directories are required.');
  if(!Number.isInteger(toolTimeoutMs)||toolTimeoutMs<1)throw Error('A positive tool timeout is required.');
  const outputRoot=await realpath(directory),profileRoot=await realpath(profile);
  const children=new Map(),pendingIds=new Set(),activeCalls=new Map(),initializedChildren=new WeakSet();let selected=null,closing=false,closePromise,host,outerInitialized=null,inFlight=0,dispatch=Promise.resolve();
  const token=randomBytes(32).toString('hex');
  const queue=fn=>{const next=dispatch.then(fn,fn);dispatch=next.catch(()=>{});return next;};
  async function child(mode){
    if(children.has(mode))return children.get(mode);
    const opening=(async()=>{
      const childDirectory=await makeDir(outputRoot,`external-${mode}`),childProfile=await makeDir(profileRoot,`external-${mode}`);
      const gateway=await childGatewayFactory({directory:childDirectory,profile:childProfile,onControlChange:(...args)=>onControlChange(...args),...(launchExternalContext?{launchContext:(...args)=>launchExternalContext({mode,profile:childProfile,...(args[1]??{})})}:{})});
      return gateway;
    })();
    children.set(mode,opening);
    try{const value=await opening;children.set(mode,value);return value;}
    catch(error){if(children.get(mode)===opening)children.delete(mode);throw error;}
  }
  function current(){return selected?children.get(selected):null;}
  async function childInitialize(gateway,signal){
    if(!outerInitialized||initializedChildren.has(gateway))return;
    const config=gateway.aiMcpServer;
    const response=await fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify(outerInitialized),...(signal?{signal}:{})});
    await response.arrayBuffer();
    if(!response.ok)throw Error('Browser child initialization failed.');
    initializedChildren.add(gateway);
  }
  const http=createServer(async(req,res)=>{
    if(closing){res.writeHead(503).end();return;}
    if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers.host!==host||req.headers.origin!==undefined&&req.headers.origin!==`http://${host}`){res.writeHead(403).end();return;}
    res.setHeader('Cache-Control','no-store');
    if(!bearerMatches(req.headers.authorization,token)){res.writeHead(401).end();return;}
    if(req.url!=='/mcp'){res.writeHead(404).end();return;}
    if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'}).end();return;}
    let timer,reqMessage,finished=false,registered=false;const controller=new AbortController();
    const cancel=()=>{if(!finished)controller.abort();};
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Error('Request too large.');chunks.push(chunk);}
      reqMessage=JSON.parse(Buffer.concat(chunks));
      if(!reqMessage||Array.isArray(reqMessage)||reqMessage.jsonrpc!=='2.0'||typeof reqMessage.method!=='string')throw Error('Invalid request.');
      if(reqMessage.id!==undefined&&!['string','number'].includes(typeof reqMessage.id))throw Error('Invalid request ID.');
      if(reqMessage.id!==undefined){if(pendingIds.has(reqMessage.id)){res.writeHead(409).end();return;}pendingIds.add(reqMessage.id);registered=true;}
      if(reqMessage.method==='tools/call'&&reqMessage.id===undefined)throw Error('Tool calls require a request ID.');
      if(reqMessage.method==='tools/call'){registered=true;activeCalls.set(reqMessage.id,controller);res.once('close',cancel);timer=setTimeout(()=>{cancel();res.destroy();},toolTimeoutMs);}
      if(reqMessage.method==='notifications/cancelled'){
        activeCalls.get(reqMessage.params?.requestId)?.abort();res.writeHead(202).end();finished=true;return;
      }
      let result=await queue(async()=>{
        if(controller.signal.aborted)return new Response(null,{status:202});
        if(reqMessage.method==='notifications/initialized')return new Response(null,{status:202});
        if(reqMessage.method==='ping')return jsonResponse({jsonrpc:'2.0',id:reqMessage.id,result:{}});
        if(reqMessage.method==='initialize'){
          outerInitialized=reqMessage;
          const gateway=current();
          if(gateway)return forward(gateway,reqMessage,controller.signal);
          return new Response(JSON.stringify({jsonrpc:'2.0',id:reqMessage.id,result:{protocolVersion:reqMessage.params?.protocolVersion??'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'k-external-browser-gateway',version:'1'}}}),{status:200,headers:{'Content-Type':'application/json'}});
        }
        if(reqMessage.method==='tools/list'){
          // A dormant regular child supplies the actual SDK schemas without
          // selecting a mode or opening Chrome. The model can then discover
          // the full tool surface before invoking browser_session.
          const gateway=current()??await child('regular');
          await childInitialize(gateway,controller.signal);
          const proxied=await forward(gateway,reqMessage,controller.signal);const message=unpack(await proxied.text());
          if(message.result?.tools){
            message.result.tools=message.result.tools.map(tool=>({...tool,description:cleanDescription(tool.description)}));
            if(!message.result.tools.some(tool=>tool.name==='browser_session'))message.result.tools.push(browserSessionTool);
          }
          return pack(proxied,message);
        }
        if(reqMessage.method==='tools/call'&&reqMessage.params?.name==='browser_session'){
          const mode=reqMessage.params?.arguments?.mode;
          if(!MODES.has(mode))return jsonResponse(rpcError(reqMessage.id,-32602,'Choose mode regular or incognito.'));
          const gateway=current();
          if(gateway){
            const state=await gateway.getState();
            if(state.recoveryRequired)return jsonResponse(toolError(reqMessage.id,'瀏覽器連線已中止。請重新開啟對話以重新連線；先前操作不會自動重送。'));
            if(inFlight||state.busy)return jsonResponse(toolError(reqMessage.id,'Cannot switch browser mode while a browser operation is active.'));
            if(state.mode==='human')return jsonResponse(toolError(reqMessage.id,'Cannot switch browser mode while human control is enabled.'));
            if(mode===selected)return jsonResponse({jsonrpc:'2.0',id:reqMessage.id,result:{content:[{type:'text',text:`External Chrome ${mode} mode is already selected.`}]}});
          }
          // A failed explicit selection must not leave the previous mode as
          // an implicit fallback target.
          selected=null;
          let target;
          try{
            target=await child(mode);await childInitialize(target,controller.signal);
            // Make browser_session mean an actually connected session, rather
            // than merely remembering a preference. This uses the SDK's
            // harmless state read and never falls back to another mode.
            const warm=unpack(await (await forward(target,{jsonrpc:'2.0',id:`external-session-${mode}`,method:'tools/call',params:{name:'browser_snapshot',arguments:{}}},controller.signal)).text());
            const detail=warm.error?.message??(warm.result?.isError?warm.result.content?.find(item=>item.type==='text')?.text:null);
            if(warm.error||warm.result?.isError)throw Error(detail||'External browser session did not become ready.');
          }
          catch(error){selected=null;if(target){await target.close().catch(()=>{});if(children.get(mode)===target)children.delete(mode);}return jsonResponse(toolError(reqMessage.id,`Could not open external Chrome ${mode} mode: ${String(error?.message??'session startup failed').slice(0,300)}. No fallback was selected.`));}
          selected=mode;
          onControlChange({type:'external-browser-mode',mode});
          return jsonResponse({jsonrpc:'2.0',id:reqMessage.id,result:{content:[{type:'text',text:`Selected external Chrome ${mode} mode.`}]}});
        }
        const gateway=current();
        if(reqMessage.method==='tools/call'&&!gateway)return jsonResponse(toolError(reqMessage.id,'Select browser_session mode regular or incognito before using browser tools.'));
        if(!gateway)return jsonResponse(rpcError(reqMessage.id,-32002,'Select a browser mode first.'));
        if(reqMessage.method==='tools/call')inFlight++;
        return forward(gateway,reqMessage,controller.signal,reqMessage.method==='tools/call'?()=>{inFlight=Math.max(0,inFlight-1);}:undefined);
      });
      if(result instanceof Response){res.writeHead(result.status,Object.fromEntries(result.headers));res.flushHeaders();if(result.body)await pipeline(Readable.fromWeb(result.body),res);else res.end();}
      else res.end();
      finished=true;
    }catch{
      if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify(rpcError(reqMessage?.id,-32600,'Invalid browser MCP request.')));else res.destroy();
    }finally{clearTimeout(timer);res.off('close',cancel);if(reqMessage?.id!==undefined){pendingIds.delete(reqMessage.id);if(activeCalls.get(reqMessage.id)===controller)activeCalls.delete(reqMessage.id);}if(registered)controller.abort();}
  });
  async function forward(gateway,message,signal,onDone){
    const config=gateway.aiMcpServer;
    let response;
    try{response=await fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify(message),signal});}
    catch(error){onDone?.();throw error;}
    if(!onDone)return response;
    if(!response.body){onDone();return response;}
    const reader=response.body.getReader();let released=false;
    const finish=()=>{if(!released){released=true;onDone();}};
    const body=new ReadableStream({async pull(controller){try{const item=await reader.read();if(item.done){finish();controller.close();}else controller.enqueue(item.value);}catch(error){finish();controller.error(error);}},async cancel(reason){finish();await reader.cancel(reason);}});
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }
  function jsonResponse(message){return new Response(JSON.stringify(message),{status:200,headers:{'Content-Type':'application/json'}});}
  function toolError(id,message){return {jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:message}]}};}
  async function close(){
    if(closePromise)return closePromise;
    closing=true;
    closePromise=(async()=>{http.closeAllConnections();await new Promise(resolve=>http.close(()=>resolve()));const values=await Promise.allSettled([...children.values()].map(async item=>(await item).close()));const errors=values.filter(item=>item.status==='rejected').map(item=>item.reason);if(errors.length)throw new AggregateError(errors,'External browser shutdown was not confirmed.');})();
    return closePromise;
  }
  await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve);});host=`127.0.0.1:${http.address().port}`;
  return {
    aiMcpServer:{type:'http',url:`http://${host}/mcp`,headers:{Authorization:`Bearer ${token}`}},
    async humanRequest(route,body){
      const gateway=current();
      if(!gateway){if(route==='/state')return Response.json({available:false,busy:false,mode:'ai',external:true,browserMode:null});if(route==='/action')return Response.json({available:false,busy:false,mode:'ai',external:true,browserMode:null,error:'Select an external browser mode first.'},{status:409});throw Error('Select an external browser mode first.');}
      const response=await gateway.humanRequest(route,body);
      if(route!=='/state'&&route!=='/action'||!response.headers.get('content-type')?.includes('application/json'))return response;
      const state=await response.clone().json(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('content-type','application/json; charset=utf-8');return Response.json({...state,external:true,browserMode:selected},{status:response.status,headers});
    },
    async getState(){const gateway=current();if(!gateway)return {available:false,busy:inFlight>0,mode:'ai',external:true,selectedMode:null,browserMode:null};const state=await gateway.getState();return {...state,busy:state.busy||inFlight>0,external:true,selectedMode:selected,browserMode:selected};},
    getControlSnapshot(){const gateway=current();if(!gateway)return {available:false,busy:inFlight>0,mode:'ai',external:true,selectedMode:null,browserMode:null};const state=gateway.getControlSnapshot();return {...state,busy:state.busy||inFlight>0,external:true,selectedMode:selected,browserMode:selected};},
    close,
  };
}
