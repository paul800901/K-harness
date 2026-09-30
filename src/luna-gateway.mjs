import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {McpServer, WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {lunaResult} from './luna-bridge.mjs';

const requestId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const idSchema = z.strictObject({requestId});
const taskSchema = z.strictObject({requestId,task:z.string().min(1).max(32000).refine(value=>value.trim().length>0)});
const waitSchema = z.strictObject({requestId,timeoutMs:z.number().int().min(0).max(60000).default(30000)});

function createMcpServer(bridge) {
  const server = new McpServer({name:'k-luna-gateway',version:'0.1.0'}, {capabilities:{tools:{}}});
  const register = (name,description,inputSchema,execute,annotations) => server.registerTool(name,{description,inputSchema,annotations},async args=>{
    try {
      const value=await lunaResult(await execute(args));
      const response={structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]};
      bridge.resultReady?.(args,value);
      return response;
    } catch (error) {
      return {isError:true,content:[{type:'text',text:`${String(error?.message ?? error)} Inspect the same requestId; do not retry under a new ID.`}]};
    }
  });
  register('luna_start','Start one bounded task with subscription Codex GPT-6 Luna high. K automatically delivers completion to this conversation after your current turn. Do other useful work or end your turn; do not poll. Reuse the requestId only for the identical task.',taskSchema,
    args=>bridge.start(args),{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false});
  register('luna_wait','Manual recovery only: wait for an existing Luna task. Normal work is completion-notified automatically; do not repeatedly call this tool. A timeout does not cancel or replay it.',waitSchema,
    args=>bridge.wait(args),{readOnlyHint:true,idempotentHint:true,openWorldHint:false});
  register('luna_inspect','Read existing Luna task state without starting or replaying work.',idSchema,
    args=>bridge.inspect(args),{readOnlyHint:true,idempotentHint:true,openWorldHint:false});
  register('luna_cancel','Request cancellation of an existing Luna task and read back its native state.',idSchema,
    args=>bridge.cancel(args),{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false});
  return server;
}

async function readBody(req, limit=1024*1024) {
  const chunks=[];let length=0;
  for await (const chunk of req) {
    length+=chunk.length;
    if(length>limit)throw new Error('request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function bearerMatches(header, token) {
  if(typeof header!=='string'||!header.startsWith('Bearer '))return false;
  const actual=Buffer.from(header.slice(7));const expected=Buffer.from(token);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

/** Start a token-authenticated, loopback-only MCP HTTP gateway for one Luna bridge. */
export async function createLunaGateway({bridge}) {
  if(!bridge||!['start','wait','inspect','cancel'].every(name=>typeof bridge[name]==='function'))throw new TypeError('A complete Luna bridge is required.');
  const token=randomBytes(32).toString('base64url');
  const mcp=createMcpServer(bridge);
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined});
  await mcp.connect(transport);
  let closed=false, closing=false, closePromise, expectedHost, expectedOrigin;
  const http=createServer(async(req,res)=>{
    if(closed||closing){res.writeHead(503).end();return;}
    if(req.socket.remoteAddress!=='127.0.0.1'&&req.socket.remoteAddress!=='::ffff:127.0.0.1') {res.writeHead(403).end();return;}
    if(req.headers.host!==expectedHost||(req.headers.origin!==undefined&&req.headers.origin!==expectedOrigin)){res.writeHead(403).end();return;}
    if(!bearerMatches(req.headers.authorization,token)){res.writeHead(401,{'WWW-Authenticate':'Bearer'}).end();return;}
    if(req.url!=='/mcp'){res.writeHead(404).end();return;}
    if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'}).end();return;}
    try {
      const body=await readBody(req);
      const webRequest=new Request(`http://127.0.0.1${req.url}`,{method:'POST',headers:req.headers,body,duplex:'half'});
      const response=await transport.handleRequest(webRequest);
      const headers=Object.fromEntries(response.headers.entries());
      res.writeHead(response.status,headers);
      if(response.body)await pipeline(Readable.fromWeb(response.body),res);else res.end();
    } catch {
      if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',error:{code:-32600,message:'Invalid MCP request.'}}));
      else res.destroy();
    }
  });
  await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve);});
  const address=http.address();
  const url=`http://127.0.0.1:${address.port}/mcp`;
  expectedHost=`127.0.0.1:${address.port}`;
  expectedOrigin=`http://${expectedHost}`;
  const mcpConfig={mcpServers:{k_luna:{type:'http',url,headers:{Authorization:`Bearer ${token}`}}}};
  async function close(){
    if(closed)return;
    if(closing)return closePromise;
    closing=true;
    closePromise=(async()=>{
      try {
        await bridge.close?.();
        closed=true;
        await new Promise(resolve=>http.close(()=>resolve()));
        await transport.close().catch(()=>{});
      } finally {
        closing=false;
        if(!closed)closePromise=null;
      }
    })();
    return closePromise;
  }
  return {mcpConfig,close};
}
