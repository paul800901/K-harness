import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openCodexHost} from '../src/codex-host.mjs';
const source=path.resolve('.runtime/browser-live-probe/probe-codex-df9c7013-1287-4cb7-9d0d-4acfb504a948/evidence.json');
const original=JSON.parse(await readFile(source,'utf8'));
if(!process.argv.includes('--run')){console.log(JSON.stringify({dryRun:true,threadId:original.threadId,scope:'Resume only the existing isolated probe thread; no turn/start, model calls, real websites or production changes.'}));process.exit(0);}
const executable=process.argv[process.argv.indexOf('--executable')+1];
if(!path.isAbsolute(executable??''))throw new Error('Pass --executable with absolute Codex path.');
const root=path.resolve('.runtime/browser-reconnect-probe',randomUUID());
const output=path.join(root,'output'),profile=path.join(root,'profile');
await mkdir(output,{recursive:true});await mkdir(profile);
const config={cwd:root,model:'gpt-6-luna',approvalPolicy:'on-request',sandbox:'workspace-write',config:{mcp_servers:{k_browser:{command:process.execPath,args:[path.resolve('src/browser-mcp-stdio.mjs'),output,profile],cwd:output,startup_timeout_sec:30,tool_timeout_sec:120}}}};
let host;const evidence={threadId:original.threadId,startedAt:new Date().toISOString(),checks:{}};
const connect=async()=>{host=openCodexHost({executable,cwd:root,onRequest:()=>undefined});await host.request('initialize',{clientInfo:{name:'k_browser_reconnect_probe',version:'1'},capabilities:{experimentalApi:true}});host.notify({method:'initialized',params:{}});};
const resume=async()=>{await host.request('thread/resume',{...config,threadId:original.threadId});await host.waitForMcp(original.threadId,'k_browser');return JSON.parse(await readFile(path.join(profile,'live.json'),'utf8'));};
const invoke=async(d,route,body)=>{const r=await fetch(`http://127.0.0.1:${d.port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${d.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Browser ${r.status}`);return r.json();};
try{await connect();const first=await resume();const second=await resume();evidence.checks.sameHostResumeReplaced=first.token!==second.token;
await host.close();await connect();const third=await resume();evidence.checks.newHostReplaced=second.token!==third.token;
const state=await invoke(third,'/action',{type:'takeover'});evidence.checks.newHostBrowserUsable=state.available===true&&state.mode==='human'&&!state.busy;
}catch(e){evidence.error=e.message;evidence.protocolError=e.protocolMessage;}finally{await host?.close();}
evidence.endedAt=new Date().toISOString();const file=path.join(root,'evidence.json');await writeFile(file,JSON.stringify(evidence,null,2));console.log(JSON.stringify({file,...evidence},null,2));
