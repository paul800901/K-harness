import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { openCodexHost } from './codex-host.mjs';
import { answerMainQuestion } from './main-questions.mjs';
import { collectWorkerIds, checkMainWorkers } from './main-workers.mjs';
import {saveMainSession,listMainSessions} from './main-sessions.mjs';
import {listMainModels,findMainModel} from './main-models.mjs';
import path from 'node:path';

const [executable,model,live,resumeId]=process.argv.slice(2);
const root=fileURLToPath(new URL('../',import.meta.url));
if(executable==='--list'){
 const result=await listMainSessions(root);
 for(const entry of result.sessions)stdout.write(`${entry.lastOpenedAt} | ${entry.model} | ${entry.threadId}\n`);
 if(!result.sessions.length)stdout.write('尚無 K 對話紀錄。\n');
 if(result.unreadable)stdout.write(`${result.unreadable} 份紀錄無法讀取，未刪除或重建。\n`);
 process.exit(0);
}
if(!executable||typeof model!=='string'||!model.trim()||live!=='--live')throw new Error('Use installed Codex executable, an exact picker-visible model, --live and optional saved thread ID.');
if(resumeId){const saved=(await listMainSessions(root)).sessions.find(s=>s.threadId===resumeId);if(!saved||path.relative(root,saved.workspace)!=='')throw new Error('此入口只接續 K 根工作區的既有對話；其他工作區請從 K 圖形介面開啟。');}
let threadId,turnId,completeTurn;
const workerItems=new Map();let stopping=null;let starting=false;let interruptRequested=false;
let questionAbort=new AbortController();
const terminal=createInterface({input:stdin,output:stdout});
const host=openCodexHost({executable,cwd:root,onRequest:message=>message.params?.turnId!==turnId?undefined:answerMainQuestion(message,{threadId,ask:text=>terminal.question(text,{signal:questionAbort.signal}),show:text=>stdout.write(text)}),onEvent(event){
 if(event.params?.threadId!==threadId)return;
 if(['item/started','item/completed'].includes(event.method)&&event.params.item?.type==='mcpToolCall')workerItems.set(event.params.item.id,event.params.item);
 if(event.method==='item/agentMessage/delta')stdout.write(event.params.delta);
 if(event.method==='turn/completed'){stdout.write('\n');completeTurn?.(event.params.turn);}
}});
let closing=false;
async function showWorkers(stop=false) {
 const results=await checkMainWorkers(host,threadId,collectWorkerIds([...workerItems.values()]),{stop,workspace:root});
 for(const result of results)stdout.write(`工人 ${result.requestId}：${result.status}；此查詢不判定成果是否已驗收。\n`);
 for(const result of results)for(const artifact of result.artifacts??[])stdout.write(`  ${artifact.path}：${artifact.observation}\n`);
 if(results.some(r=>!r.settled))stdout.write('仍有工人狀態未確認；不要重派原工作，先查現有成果。\n');
 if(!results.length)stdout.write('本對話尚無已記錄的 K 派工。\n');
}
const interrupt=()=>{
 if(stopping)return;
 if(starting&&!turnId){interruptRequested=true;return;}
 if(!turnId){closing=true;terminal.close();return;}
 const currentTurn=turnId;questionAbort.abort();
 stdout.write('\n正在中止主回合並確認本對話的工人；不會重送或刪除成果。\n');
 stopping=(async()=>{
   await host.request('turn/interrupt',{threadId,turnId:currentTurn});
   await showWorkers(true);
 })().catch(()=>stdout.write('中止／工人狀態未確認；不自動重派，請用 /workers 查明。\n'));
};
process.on('SIGINT',interrupt);
terminal.on('SIGINT',interrupt);
try {
 await host.request('initialize',{clientInfo:{name:'k_harness',version:'0.1.0'}});host.notify({method:'initialized',params:{}});
 const auth=await host.request('account/read',{refreshToken:false});
 if(auth.account?.type!=='chatgpt')throw new Error('Existing ChatGPT subscription login required; no API fallback.');
 const models=await listMainModels(host);
 if(!findMainModel(models,model))throw new Error('Requested model is unavailable; no fallback.');
 const config={model,cwd:root,approvalPolicy:'on-request',sandbox:'read-only'};
 const session=await host.request(resumeId?'thread/resume':'thread/start',resumeId?{...config,threadId:resumeId}:config);
 threadId=session.thread.id;
 const savedSession=(await listMainSessions(root)).sessions.find(s=>s.threadId===threadId);
 await saveMainSession(root,{...savedSession,threadId,model});
 stdout.write(`已保存 K 對話 ${threadId}；可用 Start-K.ps1 -List 找回。\n`);
 await host.waitForMcp(threadId,'k_flash');
 if(resumeId){
  const prior=await host.request('thread/read',{threadId,includeTurns:true});
  for(const turn of prior.thread.turns??[])for(const item of turn.items??[])if(item.type==='mcpToolCall')workerItems.set(item.id,item);
  await showWorkers();
 }
 stdout.write(`K HARNESS | ${model} | ChatGPT 訂閱\n對話 ${threadId}\n主代理唯讀；寫入交由明確授權的 K 工人。/workers 查工人，/exit 結束。工作中 Ctrl+C 中止主回合與已確認仍在執行的工人，保留成果；閒置時 Ctrl+C 離開。\n`);
 while(!closing){
  let prompt;try{prompt=await terminal.question('\n你 > ');}catch{break;}
  if(prompt.trim()==='/exit')break;if(!prompt.trim())continue;
  if(prompt.trim()==='/workers'){await showWorkers();continue;}
  questionAbort=new AbortController();starting=true;interruptRequested=false;
  const done=new Promise(resolve=>{completeTurn=resolve;});
  const begun=await host.request('turn/start',{threadId,input:[{type:'text',text:prompt}]});turnId=begun.turn.id;starting=false;
  if(interruptRequested)interrupt();
  const result=await Promise.race([done,host.closed.then(()=>{throw new Error('主控程序已結束；請先查原對話，不自動重送。');})]);turnId=null;completeTurn=null;
  if(stopping){await stopping;stopping=null;}
  if(result.status!=='completed')stdout.write(`回合狀態：${result.status}；不自動重送。\n`);
 }
} finally {
 process.removeListener('SIGINT',interrupt);terminal.removeListener('SIGINT',interrupt);questionAbort.abort();terminal.close();
 if(threadId)await showWorkers(true).catch(()=>stdout.write('離開前仍無法確認工人狀態；下次重開先查原工作，不重送。\n'));
 await host.close();
}
