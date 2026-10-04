import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {McpServer, WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {lunaResult} from './luna-bridge.mjs';

const requestId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const idSchema = z.strictObject({requestId});
const taskSchema = z.strictObject({requestId,model:z.enum(['gpt-6.1-sol','gpt-6-luna','gemini-3.8-flash']).optional(),effort:z.string().min(1).optional(),accountId:z.string().regex(/^[a-f0-9]{32}$/u).optional(),handoffFrom:requestId.optional(),task:z.string().min(1).max(32000).refine(value=>value.trim().length>0)}).refine(args=>args.model!=='gemini-3.8-flash'||['low','medium','high'].includes(args.effort),{message:'Flash effort 必須是 low|medium|high'});
const geminiTaskSchema = z.strictObject({requestId,model:z.literal('gemini-3.8-flash').default('gemini-3.8-flash'),effort:z.enum(['low','medium','high']),accountId:z.string().regex(/^[a-f0-9]{32}$/u).optional(),handoffFrom:requestId.optional(),task:z.string().min(1).max(32000).refine(value=>value.trim().length>0)});
const waitSchema = z.strictObject({requestId,timeoutMs:z.number().int().min(0).max(60000).default(30000)});

function createMcpServer(bridge,{geminiOnly=false}={}) {
  const prefix=geminiOnly?'gemini':'luna';
  const server = new McpServer({name:geminiOnly?'k-gemini-gateway':'k-luna-gateway',version:'0.1.0'}, {capabilities:{tools:{}}});
  const policy=bridge.workerPolicy;
  const selectionGuidance=geminiOnly?'此入口只派 Gemini Flash；必須明確指定 low/medium/high。GPT 子代理使用原生派工，不從本入口轉派。':policy.model==='auto'
    ? `AI 自動選擇目前啟用：每次派工都必須明確提供 model 與 effort；一般工人優先 Flash，Sol 為日常技術主腦，可交付規劃、架構、除錯與複查，但此入口派出的 Sol 子代理不能再派工；Luna 僅用於規則遵守要求極高的小任務。當輪明確指定優先，推理程度依官方支援清單。`
    : `目前預設為 ${policy.model} / ${policy.effort}；可省略欄位沿用預設，也可依任務明確改選。`;
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
  if(bridge.accounts)server.registerTool('gemini_accounts',{description:'Read K Gemini account identities and last checked native quotas. Cached percentages are not live proof. Keep using one account until its official five-hour or weekly quota is confirmed exhausted, then use the next available account in saved order; do not round-robin, balance usage, or switch back just because an earlier account reset. Five-hour exhaustion permits a handoff without waiting for weekly exhaustion or the window reset. Login, permission, generic rate-limit, network and timeout errors are not proof of quota exhaustion. accountId explicitly selects an enrolled account only for an explicit user choice or this verified quota handoff; omission follows this same policy. Wait for all Gemini work to stop before switching. For a stopped worker, inspect its results and real project files, then start a NEW requestId with handoffFrom and only the remaining task; never replay an unknown outcome. If none is available, wait or report instead of changing models or billing. This read-only tool does not change login.',inputSchema:z.strictObject({}),annotations:{readOnlyHint:true,idempotentHint:true}},async()=>{const value=await bridge.accounts();return {content:[{type:'text',text:JSON.stringify(value)}]};});
  register(`${prefix}_start`,`${geminiOnly?'Start one bounded task with Antigravity subscription Gemini 3.8 Flash.':'Start one bounded task with subscription Codex GPT-6.1 Sol or GPT-6 Luna, or Antigravity Gemini 3.8 Flash.'} Flash 是使用者優先的一般工人，也適合文章、審美及提出方向，不限機械性工作；依目前 K 分工與明確指定選擇。Sol 寫碼後必須交真正的 Opus 5.5 審核；無審查管道則標示待審，不冒稱完成。Flash effort 只接受 low|medium|high；非完整存取模式不能跑指令；workspace-write 只能寫工作區（嘗試寫外部會讓該次工作 failed），唯讀不能寫檔；被拒項目列在 deniedTools。 ${selectionGuidance} Effort must be supported by the selected official model. K automatically delivers completion to this conversation after your current turn. Do other useful work or end your turn; do not poll. Reuse the requestId only for the identical task.`,geminiOnly?geminiTaskSchema:taskSchema,
    args=>bridge.start(args),{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false});
  register(`${prefix}_wait`,`Manual recovery only: wait for an existing ${geminiOnly?'Flash':'Sol, Luna or Flash'} subagent task. Normal work is completion-notified automatically; do not repeatedly call this tool. A timeout does not cancel or replay it.`,waitSchema,
    args=>bridge.wait(args),{readOnlyHint:true,idempotentHint:true,openWorldHint:false});
  register(`${prefix}_inspect`,'Read existing worker task state without starting or replaying work.',idSchema,
    args=>bridge.inspect(args),{readOnlyHint:true,idempotentHint:true,openWorldHint:false});
  register(`${prefix}_cancel`,'Request cancellation of an existing worker task and read back its native state.',idSchema,
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
export async function createLunaGateway({bridge,geminiOnly=false}) {
  if(!bridge||!['start','wait','inspect','cancel'].every(name=>typeof bridge[name]==='function'))throw new TypeError('A complete Luna bridge is required.');
  const token=randomBytes(32).toString('base64url');
  const mcp=createMcpServer(bridge,{geminiOnly});
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
  const mcpConfig={mcpServers:{[geminiOnly?'k_gemini':'k_luna']:{type:'http',url,headers:{Authorization:`Bearer ${token}`}}}};
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
