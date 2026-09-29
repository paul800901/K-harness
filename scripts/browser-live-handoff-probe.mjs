// Opus isolated probe: model reads a local fake page, a human takes over and edits
// it through the live-session API, and the model reads the same page back after
// release. Dry run by default; one provider per run; loopback fake page only.
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {openCodexHost} from '../src/codex-host.mjs';
import {openClaudeHost,resolveClaudeCommand} from '../src/claude-host.mjs';
import {threadPermissions,turnPermissions} from '../src/desktop-permissions.mjs';
import {browserLiveRequest} from '../src/browser-live-proxy.mjs';

const provider=process.argv[2];
if(!['claude','codex'].includes(provider)){console.error('Usage: node scripts/browser-live-handoff-probe.mjs <claude|codex> [--run] [--codex-executable <abs path>]');process.exit(2);}
const run=process.argv.includes('--run');
const exeIndex=process.argv.indexOf('--codex-executable');
const codexExe=exeIndex<0?null:process.argv[exeIndex+1];
const tag=randomBytes(4).toString('hex').toUpperCase();
const marker=`K_FAKE_PAGE_${tag}`, humanText=`K_HUMAN_EDIT_${tag}`;
const key=`probe-${provider}-${randomUUID()}`;
const root=path.resolve('.runtime/browser-live-probe',key);
const workspace=path.join(root,'workspace'), output=path.join(root,'output'), profile=path.join(root,'.runtime','browser-profiles',key);
const entry=path.resolve('src/browser-mcp-stdio.mjs');
const TURN_TIMEOUT=150000;

const prompts={
 read:url=>`Isolated browser probe on a local fake page. Use ONLY the k_browser MCP tools (ToolSearch to load their schemas is allowed). Call browser_navigate with url exactly ${url}, then browser_snapshot. Do not use shell, files, agents or any other URL. Reply with the exact marker text that starts with K_FAKE_PAGE_ shown on the page, in one short sentence.`,
 during:()=>`Call k_browser browser_snapshot exactly once, with no other tools. If the call is denied, stop immediately without retrying and quote the denial reason in one short sentence.`,
 after:()=>`Call k_browser browser_snapshot exactly once (no other tools, no navigation). Report the exact text currently shown in the "Mirror:" line and the value of the Note textbox, in one short sentence.`,
};

if(!run){console.log(JSON.stringify({dryRun:true,provider,root,marker,humanText,prompts:{read:prompts.read('http://127.0.0.1:<port>/'),during:prompts.during(),after:prompts.after()}},null,2));process.exit(0);}

await mkdir(workspace,{recursive:true});await mkdir(output,{recursive:true});await mkdir(profile,{recursive:true});
const pageLog=[];
const page=createServer((req,res)=>{pageLog.push({method:req.method,url:req.url,remote:req.socket.remoteAddress});
 if(req.url!=='/'){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
 res.end(`<!doctype html><html><head><title>K fake page</title><style>body{margin:0;font:16px sans-serif}#note{position:absolute;left:40px;top:200px;width:400px;height:40px}</style></head><body><h1>${marker}</h1><p>Fake local page. No account.</p><label for="note">Note</label><input id="note" aria-label="Note" value=""><p id="mirror">Mirror: (empty)</p><script>document.getElementById('note').addEventListener('input',e=>{document.getElementById('mirror').textContent='Mirror: '+e.target.value;});</script></body></html>`);
});
await new Promise(r=>page.listen(0,'127.0.0.1',r));
const fakeUrl=`http://127.0.0.1:${page.address().port}/`;
const fakeState={threadId:'probe-thread',browserAccess:{enabled:true,sessionKey:key}};
const live=(route,body)=>browserLiveRequest(root,fakeState,'probe-thread',route,body);
const allowedBrowserTools=new Set(['browser_navigate','browser_snapshot']);
const evidence={provider,startedAt:new Date().toISOString(),fakeUrl,marker,humanText,steps:[],approvals:[],toolCalls:[],errors:[]};
const step=(name,data)=>{evidence.steps.push({name,at:new Date().toISOString(),...data});};
const toolOk=(name,args)=>allowedBrowserTools.has(name)&&(name!=='browser_navigate'||args?.url===fakeUrl);

async function withTimeout(promise,label){let t;try{return await Promise.race([promise,new Promise((_,rej)=>{t=setTimeout(()=>rej(new Error(`${label} timed out`)),TURN_TIMEOUT);})]);}finally{clearTimeout(t);}}

async function humanPhase(){
 const before=await live('/state');const frame=await live('/frame');
 step('right-side-view-after-read',{url:before.url,pages:before.pages?.length,mode:before.mode,frameBytes:frame.bytes?.length??0,sameUrl:before.url===fakeUrl});
 const taken=await live('/action',{type:'takeover'});step('takeover',{mode:taken.mode,busy:taken.busy});
 const clicked=await live('/action',{type:'click',x:240,y:220});
 const typed=await live('/action',{type:'text',text:humanText});
 step('human-edit',{clickMode:clicked.mode,typedMode:typed.mode});
 const frame2=await live('/frame');step('right-side-view-after-edit',{frameBytes:frame2.bytes?.length??0});
}
async function release(){const r=await live('/action',{type:'release'});step('release',{mode:r.mode,busy:r.busy});}

async function codexRun(){
 if(!codexExe||!path.isAbsolute(codexExe))throw new Error('--codex-executable requires an absolute path.');
 let threadId,turnId,finish;const texts=[];
 const host=openCodexHost({executable:codexExe,cwd:workspace,onEvent(e){const p=e.params??{};
   if(p.threadId&&p.threadId!==threadId)return;
   if(e.method==='item/completed'&&p.item?.type==='mcpToolCall')evidence.toolCalls.push({turnId:p.turnId,tool:p.item.tool,server:p.item.server,args:p.item.arguments,status:p.item.status,error:p.item.error,result:JSON.stringify(p.item.result??null).slice(0,1500)});
   if(e.method==='item/completed'&&p.item?.type==='agentMessage')texts.push(p.item.text);
   if(e.method==='turn/completed'&&p.turn?.id===turnId)finish(p.turn.status);
 },onRequest:async m=>{
   const meta=m.params?._meta??{},tool=/run tool "([^"]+)"/.exec(m.params?.message??'')?.[1];
   const ok=m.method==='mcpServer/elicitation/request'&&meta.codex_approval_kind==='mcp_tool_call'&&m.params?.serverName==='k_browser'&&toolOk(tool,meta.tool_params);
   evidence.approvals.push({method:m.method,tool,args:meta.tool_params,decision:ok?'accept':'decline'});
   if(m.method==='mcpServer/elicitation/request')return ok?{action:'accept',content:{}}:{action:'decline',content:null};
   return undefined;
 }});
 try{
  await host.request('initialize',{clientInfo:{name:'k_browser_live_probe',version:'1'},capabilities:{experimentalApi:true}});host.notify({method:'initialized',params:{}});
  const account=await host.request('account/read',{refreshToken:false});if(account.account?.type!=='chatgpt')throw new Error('ChatGPT subscription not verified.');
  const perms=threadPermissions('workspace-write',workspace);
  const started=await host.request('thread/start',{cwd:workspace,model:'gpt-6-luna',...perms,config:{...perms.config,model_reasoning_effort:'low',mcp_servers:{k_browser:{command:process.execPath,args:[entry,output,profile],cwd:output,startup_timeout_sec:30,tool_timeout_sec:120}}}});
  threadId=started.thread.id;evidence.threadId=threadId;
  await host.waitForMcp(threadId,'k_browser');
  const turn=async(label,text)=>{const done=new Promise(r=>{finish=r;});texts.length=0;const t=turnPermissions('workspace-write',workspace);
   const begun=await host.request('turn/start',{threadId,model:'gpt-6-luna',effort:'low',input:[{type:'text',text}],approvalPolicy:t.approvalPolicy,approvalsReviewer:t.approvalsReviewer,sandboxPolicy:t.sandboxPolicy});turnId=begun.turn.id;
   const status=await withTimeout(done,label);step(`model-${label}`,{status,answer:texts.join('\n').slice(0,1000)});};
  await turn('read',prompts.read(fakeUrl));await humanPhase();await turn('during-takeover',prompts.during());await release();await turn('after-release',prompts.after());
 }finally{await host.close();}
}

async function claudeRun(){
 let finish;
 const host=await openClaudeHost({commandSpec:await resolveClaudeCommand(),cwd:workspace,sessionId:randomUUID(),accessMode:'claude-manual',effort:'low',
  mcpConfig:{mcpServers:{k_browser:{command:process.execPath,args:[entry,output,profile]}}},
  onMessage(m){
   if(m.parent_tool_use_id)return;
   if(m.type==='assistant')for(const b of m.message?.content??[])if(b.type==='tool_use')evidence.toolCalls.push({id:b.id,tool:b.name,args:b.input});
   if(m.type==='user'&&Array.isArray(m.message?.content))for(const b of m.message.content)if(b.type==='tool_result'){const row=evidence.toolCalls.find(x=>x.id===b.tool_use_id);const text=(Array.isArray(b.content)?b.content.map(x=>x.text??'').join('\n'):String(b.content??'')).slice(0,1500);if(row){row.isError=b.is_error===true;row.result=text;}}
   if(m.type==='result')finish?.({subtype:m.subtype,is_error:m.is_error,result:m.result});
  },
  onPermission({toolName,input}){
   const name=toolName.replace(/^mcp__k_browser__/,'');
   const ok=toolName==='ToolSearch'||(toolName.startsWith('mcp__k_browser__')&&toolOk(name,input));
   evidence.approvals.push({tool:toolName,args:input,decision:ok?'allow':'deny'});
   return ok?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:'Denied by isolated probe.'};
  }});
 try{
  const turn=async(label,text)=>{const done=new Promise(r=>{finish=r;});await host.start(text);const r=await withTimeout(done,label);step(`model-${label}`,{status:r.subtype,is_error:r.is_error,answer:String(r.result??'').slice(0,1000)});};
  await turn('read',prompts.read(fakeUrl));await humanPhase();await turn('during-takeover',prompts.during());await release();await turn('after-release',prompts.after());
 }finally{await host.close();}
}

try{provider==='codex'?await codexRun():await claudeRun();}
catch(error){evidence.errors.push(error.message);}
finally{page.close();}
evidence.pageRequests=pageLog;evidence.endedAt=new Date().toISOString();
const a=s=>evidence.steps.find(x=>x.name===s);
evidence.checks={
 modelReadMarker:!!a('model-read')?.answer?.includes(marker),
 rightSideSamePage:a('right-side-view-after-read')?.sameUrl===true&&(a('right-side-view-after-read')?.frameBytes??0)>0,
 takeoverHuman:a('takeover')?.mode==='human',
 aiToolDeniedDuringTakeover:evidence.toolCalls.some(c=>/human-control mode/.test(String(c.result??c.error?.message??JSON.stringify(c.error??'')))),
 releasedToAi:a('release')?.mode==='ai',
 modelReadHumanEdit:!!a('model-after-release')?.answer?.includes(humanText),
 onlyLoopbackFakePage:pageLog.every(r=>['127.0.0.1','::ffff:127.0.0.1'].includes(r.remote)),
};
const file=path.join(root,'evidence.json');await writeFile(file,JSON.stringify(evidence,null,2),{flag:'wx'});
console.log(JSON.stringify({evidencePath:file,checks:evidence.checks,errors:evidence.errors},null,2));
