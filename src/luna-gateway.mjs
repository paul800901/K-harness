import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {McpServer, WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {lunaResult} from './luna-bridge.mjs';

const requestId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const idSchema = z.strictObject({requestId});
const taskSchema = z.strictObject({requestId,model:z.string().min(1).max(256).optional(),effort:z.string().min(1).nullable().optional(),accountId:z.string().regex(/^[a-f0-9]{32}$/u).optional(),handoffFrom:requestId.optional(),task:z.string().min(1).max(32000).refine(value=>value.trim().length>0)});
const geminiTaskSchema=taskSchema.refine(args=>args.model===undefined||/^(gemini-|claude-)/.test(args.model),{message:'GPT workers use native Codex delegation.'});
const waitSchema = z.strictObject({requestId,timeoutMs:z.number().int().min(0).max(60000).default(30000)});

function createMcpServer(bridge,{geminiOnly=false,editGoal,resumeGoal}={}) {
  const prefix=geminiOnly?'gemini':'luna';
  const server = new McpServer({name:geminiOnly?'k-gemini-gateway':'k-luna-gateway',version:'0.1.0'}, {capabilities:{tools:{}}});
  if(editGoal)server.registerTool('goal_edit',{
    description:'Edit this main Codex conversation\'s existing native goal objective after discussion with the user. No second confirmation or browser is needed. Only the objective changes: preserve status, budget and usage; never resume, create a goal, restart or replay work. Subagents cannot edit the parent goal. Use native get_goal to inspect and create_goal only for a genuinely new goal. This is K conversation control, not a Gemini worker task.',
    inputSchema:z.strictObject({objective:z.string().trim().min(1).max(4000)}),
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async(args,context)=>{
    try{
      const value=await editGoal(args,context.mcpReq._meta);
      return {content:[{type:'text',text:JSON.stringify(value)}]};
    }catch(error){return {isError:true,content:[{type:'text',text:String(error?.message??error)+' Do not retry automatically; inspect the current native goal.'}]};}
  });
  if(resumeGoal)server.registerTool('goal_resume',{
    description:'Resume this main Codex conversation\'s existing paused or blocked native goal ONLY after the user explicitly asks to continue/resume it. No second confirmation or browser is needed. Editing goal text alone is NOT a resume request. Preserve the same goal objective, budget and usage; do not create a goal, restart/replay a task or bypass usage/budget limits. Safe during the current main turn: the native core manages continuation after that turn. Subagents cannot resume the parent goal. Use native get_goal to inspect. This is K conversation control, not a Gemini worker task.',
    inputSchema:z.strictObject({}),
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async(args,context)=>{
    try{
      const value=await resumeGoal(args,context.mcpReq._meta);
      return {content:[{type:'text',text:JSON.stringify(value)}]};
    }catch(error){return {isError:true,content:[{type:'text',text:String(error?.message??error)+' Do not retry automatically; inspect the current native goal.'}]};}
  });
  const policy=bridge.workerPolicy;
  const selectionGuidance=geminiOnly?'此入口可派 Gemini 或 Claude 原生訂閱工人；GPT 子代理使用原生派工，不從本入口轉派。明確提供原生模型及其支援的 effort；無推理設定時傳 null。':policy.model==='auto'
    ? `AI 自動選擇目前啟用：每次派工都必須明確提供原生目錄的 model 與 effort（沒有推理設定時為 null）；一般工人優先 Flash，Sol 為日常技術主腦，可交付規劃、架構、除錯與複查，但此入口派出的 Sol 子代理不能再派工；Luna 僅用於規則遵守要求極高的小任務。當輪明確指定優先，推理程度依官方支援清單。`
    : `目前預設為 ${policy.model} / ${policy.effort}；可省略欄位沿用預設；除非本人當輪或明確任務規則指定，否則遵守手動選擇，不因自己認為更適合而改選。`;
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
  server.registerTool(`${prefix}_list`,{
    description:`List unfinished K ${geminiOnly?'Gemini / Claude':'GPT / Claude / Gemini'} worker records for THIS conversation to find requestIds, including old unresolved jobs after restart. Use this when K shows waiting or unconfirmed workers but the requestId is unknown. K Gemini workers are NOT in Codex list_agents. No Chrome/browser is needed. These are last-known records, not proof that a process is alive; executionUnowned means this K instance does not own that execution, NOT completion or confirmed stop. Use ${prefix}_inspect with a returned requestId for the original task and details. Records with reconciliation already have a main-agent handling note; do not repeatedly investigate them without new evidence. A note is NOT native completion or stop proof. Does not start, cancel, replay, acknowledge results or switch accounts.`,
    inputSchema:z.strictObject({}),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async()=>{
    try{
      const rows=await bridge.list(false);
      const workers=rows.filter(record=>record&&!record.settled&&(!geminiOnly||['gemini','claude'].includes(record.provider))).map(record=>({
        ...Object.fromEntries(['requestId','provider','model','status','settled','executionUnowned','startedAt','lastActivityAt','lastReadAt'].filter(key=>record[key]!==undefined).map(key=>[key,record[key]])),
        ...(record.reconciliation?{reconciliation:{summary:record.reconciliation.summary,reviewedAt:record.reconciliation.reviewedAt}}:{}),
        ...(typeof record.error==='string'?{error:record.error.slice(0,500)}:{}),
      }));
      const value={workers};
      return {structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]};
    }catch(error){return {isError:true,content:[{type:'text',text:`${String(error?.message??error)} Worker states remain unknown; do not start or replay work.`}]};}
  });
  if(bridge.accounts)server.registerTool('gemini_accounts',{description:'Actively query official quotas for ALL saved K Gemini accounts while idle, temporarily switching each login and restoring the original account before returning. This is not a snapshot read. If Gemini is running or its stop is uncertain, the query is refused without switching; wait for confirmed completion, not conclude quota exhaustion or abandon the user task. quotaCheck.allExhausted is null when any result is unknown. Cached percentages are not live proof. Keep using one account until its official five-hour or weekly quota is confirmed exhausted, then use the next available account in saved order; do not round-robin, balance usage, or switch back just because an earlier account reset. Five-hour exhaustion permits a handoff without waiting for weekly exhaustion or the window reset. Login, permission, generic rate-limit, network and timeout errors are not proof of quota exhaustion. accountId binds the current worker account; it cannot bypass sequential handoff. Start after the current saved position and wrap only at the end (fourth -> fifth -> first). Each candidate must be freshly checked; unknown quota is not exhaustion or availability. Manual user switching in Settings is separate. Wait for all Gemini work to stop before switching. For a stopped worker, inspect its results and real project files, then start a NEW requestId with handoffFrom and only the remaining task; never replay an unknown outcome. Only when all saved accounts are officially confirmed exhausted may an explicitly user-authorized backup model take remaining work. Otherwise wait or report; never infer exhaustion from stale data or change billing. This tool temporarily changes Gemini login; it never sends model work or resumes a previous job.',inputSchema:z.strictObject({}),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false}},async()=>{const value=await bridge.accounts();return {content:[{type:'text',text:JSON.stringify(value)}]};});
  register(`${prefix}_start`,`${geminiOnly?'Start one bounded task with native subscription Gemini or Claude, including Opus / Sonnet / Haiku. GPT workers use Codex native agents.':'Start one bounded task with native subscription GPT, Claude (including Opus / Sonnet / Haiku) or Gemini.'} Flash 是使用者優先的一般工人，也適合文章、審美及提出方向，不限機械性工作；依目前 K 分工與明確指定選擇。Sol 寫碼後必須交真正的 Opus 5.5 審核；無審查管道則標示待審，不冒稱完成。模型與 effort 依這台原生目錄，無 effort 模型傳 null。Gemini／Claude 非完整存取模式不能跑指令；workspace-write 寫檔不得超出工作區，唯讀不能寫檔；Claude 原生核准沿用主對話。GPT 權限保持 Codex 原生模式。 ${selectionGuidance} Effort must be supported by the selected official model. K automatically delivers completion to this conversation after your current turn. Do other useful work or end your turn; do not poll. Reuse the requestId only for the identical task.`,geminiOnly?geminiTaskSchema:taskSchema,
    args=>bridge.start(args),{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false});
  register(`${prefix}_wait`,`Manual recovery only: wait for an existing ${geminiOnly?'Gemini or Claude':'GPT, Claude or Gemini'} subagent task. Normal work is completion-notified automatically; do not repeatedly call this tool. A timeout does not cancel or replay it.`,waitSchema,
    args=>bridge.wait(args),{readOnlyHint:true,idempotentHint:true,openWorldHint:false});
  register(`${prefix}_inspect`,`Read existing worker state, last genuine activity, pending approval, non-destructive inspection and known partial output references without starting or replaying work. If requestId is unknown, first use ${prefix}_list; Codex list_agents is not the K Gemini worker list. No Chrome/browser is needed. K checks prolonged silence in the runtime and sends one attention notice per quiet episode; absence of output is not proof of a dead worker. Do not repeatedly poll. Inspect existing files before any explicitly authorized recovery.`,idSchema,
    args=>bridge.inspect(args),{readOnlyHint:true,idempotentHint:true,openWorldHint:false});
  if(bridge.reconcile)server.registerTool(`${prefix}_reconcile`,{
    description:`Record or correct this main agent's handling conclusion for an executionUnowned, unsettled native-process historical job in THIS conversation. First use ${prefix}_inspect to read the original task, then inspect actual task files and relevant follow-up records with existing tools. Supply a concise summary and evidence naming what you actually checked and what remains unknown; an empty outputFiles array is not proof of no output, and a later review is not delivery acceptance. This moves the old job out of outstanding attention, but NEVER changes execution status, settled, acceptance or original evidence. It is NOT proof of completion or stop, cannot authorize handoff/replay or account switching, and does not start work or resume the goal. Identical calls are idempotent; a corrected conclusion replaces only the handling note, never original execution evidence. Failed checks must be reported as unchecked, not successful verification. Do not ask the user to manage requestIds or repeatedly poll the same historical job.`,
    inputSchema:z.strictObject({requestId,summary:z.string().trim().min(1).max(2000),evidence:z.string().trim().min(1).max(4000)}),
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async args=>{
    try{
      const value=await lunaResult(await bridge.reconcile(args));
      // A handling note is not a worker completion acknowledgement.
      return {structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]};
    }catch(error){return {isError:true,content:[{type:'text',text:String(error?.message??error)+' Inspect the same requestId; do not replay work.'}]};}
  });
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
export async function createLunaGateway({bridge,geminiOnly=false,editGoal,resumeGoal}) {
  if(!bridge||!['start','wait','inspect','cancel'].every(name=>typeof bridge[name]==='function'))throw new TypeError('A complete Luna bridge is required.');
  const token=randomBytes(32).toString('base64url');
  const mcp=createMcpServer(bridge,{geminiOnly,editGoal,resumeGoal});
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
