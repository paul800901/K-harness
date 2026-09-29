import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import {createConnection} from '@playwright/mcp';
import {createBrowserLiveSession} from './browser-live-session.mjs';
import {restrictedBrowserTransport} from './browser-mcp-stdio.mjs';

function matchesBearer(header,token){
  if(typeof header!=='string'||!header.startsWith('Bearer '))return false;
  const actual=Buffer.from(header.slice(7)),expected=Buffer.from(token);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

/**
 * Owner-side pilot: the CLI receives only AI MCP authority. Browser lifetime,
 * human control and takeover state belong to the caller, not its MCP clients.
 * This is NOT OS isolation: protect the caller, its code and its profile with
 * a verified OS boundary before connecting a model shell.
 */
export async function createBrowserOwnerGateway({directory,profile,launchContext,toolTimeoutMs=120000,onControlChange=()=>{},nativeDownloads=false}){
  if(!path.isAbsolute(directory??'')||!path.isAbsolute(profile??''))throw new Error('Absolute browser directories are required.');
  if(!Number.isInteger(toolTimeoutMs)||toolTimeoutMs<1)throw new Error('A positive tool timeout is required.');
  const root=await realpath(directory),profileRoot=await realpath(profile);
  const relative=path.relative(root,profileRoot);
  if(!relative||relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative))throw new Error('The browser profile must be outside AI browser files.');
  const live=await createBrowserLiveSession(profileRoot,{launchContext,downloadDirectory:path.join(root,'downloads'),controlMode:'in-process',onControlChange,nativeDownloads});
  const aiToken=randomBytes(32).toString('hex');
  let mcp,closing=false,closePromise,host;
  const raw=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined});
  const transport=restrictedBrowserTransport(raw,root,live);
  // One owner-side connection survives CLI reconnects. Guard duplicate IDs
  // before the SDK's shared HTTP response map can be overwritten by a client.
  const pendingIds=new Set();
  const http=createServer(async(req,res)=>{
    if(closing){res.writeHead(503).end();return;}
    if(!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers.host!==host||req.headers.origin!==undefined&&req.headers.origin!==`http://${host}`){res.writeHead(403).end();return;}
    res.setHeader('Cache-Control','no-store');
    if(!matchesBearer(req.headers.authorization,aiToken)){res.writeHead(401).end();return;}
    if(req.url!=='/mcp'){res.writeHead(404).end();return;}
    if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'}).end();return;}
    let message,timer,registered=false,finished=false;
    const cancel=()=>{
      if(finished||message?.method!=='tools/call')return;
      // HTTP disconnects/timeouts are not necessarily SDK cancellations.
      // Reuse the same close-before-unlock path as the stdio integration.
      raw.onmessage?.({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:message.id}});
    };
    try{
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw new Error('Request too large.');chunks.push(chunk);}
      const body=Buffer.concat(chunks);
      message=JSON.parse(body);
      // Do not accept batches: each HTTP lifetime owns exactly one request ID.
      if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')throw new Error('Invalid request.');
      if(message.id!==undefined){
        if(!['string','number'].includes(typeof message.id))throw new Error('Invalid request ID.');
        if(pendingIds.has(message.id)){res.writeHead(409).end();return;}
        pendingIds.add(message.id);registered=true;
      }
      if(message.method==='tools/call'){
        if(message.id===undefined)throw new Error('Tool calls require a request ID.');
        res.once('close',cancel);
        timer=setTimeout(()=>{cancel();res.destroy();},toolTimeoutMs);
      }
      const response=await raw.handleRequest(new Request(`http://${host}/mcp`,{method:'POST',headers:req.headers,body,duplex:'half'}));
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.flushHeaders();
      if(response.body)await pipeline(Readable.fromWeb(response.body),res);else res.end();
      finished=true;
    }catch{
      cancel();
      if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Invalid browser MCP request.'}));
      else res.destroy();
    }finally{
      clearTimeout(timer);res.off('close',cancel);
      if(registered)pendingIds.delete(message.id);
    }
  });
  async function close(){
    if(!closePromise)closePromise=(async()=>{
      closing=true;
      await live.close();
      http.closeAllConnections();
      await new Promise(resolve=>http.close(()=>resolve()));
      await mcp?.close();
    })();
    return closePromise;
  }
  try{
    mcp=await createConnection({browser:{browserName:'chromium',userDataDir:profileRoot,launchOptions:{channel:'msedge',headless:true}},outputDir:root,allowUnrestrictedFileAccess:false,webmcp:false},live.contextGetter);
    mcp.listRoots=async()=>({roots:[{uri:pathToFileURL(root).href,name:'K browser files'}]});
    await mcp.connect(transport);
    await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve);});
    host=`127.0.0.1:${http.address().port}`;
  }catch(error){await close();throw error;}
  return {
    // Only this field may be passed to a provider; never serialize the owner
    // object into model state or put the human capability in MCP configuration.
    aiMcpServer:{type:'http',url:`http://${host}/mcp`,headers:{Authorization:`Bearer ${aiToken}`}},
    humanRequest(route,body){
      if(!/^\/(?:state|frame)(?:\?pageId=[A-Za-z0-9-]+)?$/.test(route)&&!/^\/download\?id=[a-f0-9-]{36}$/.test(route)&&route!=='/action')throw new Error('Invalid human browser route.');
      return live.humanRequest(route,body);
    },
    getState:live.getState,
    ownerPresentation:live.ownerPresentation,
    getControlSnapshot:live.getControlSnapshot,
    ...(nativeDownloads?{acceptNativeDownload:live.acceptNativeDownload}:{}),
    close,
  };
}
