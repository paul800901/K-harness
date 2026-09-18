import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import {openCodexHost} from '../src/codex-host.mjs';

const [executable,model,flag,approvalFlag]=process.argv.slice(2);
if(!executable||!['gpt-6-astra','gpt-5.6-sol'].includes(model)||flag!=='--live')throw new Error('Supply installed Codex executable, exact Astra/Sol model and --live.');
const root=fileURLToPath(new URL('../',import.meta.url));
const base=path.join(root,'.runtime/main-tests');await mkdir(base,{recursive:true});
const directory=await mkdtemp(path.join(base,'case-'));
const relative=path.relative(root,directory).split(path.sep).join('/');
const input={marker:randomUUID(),rows:[{id:'X',minutes:3,owner:null},{id:'X',minutes:3,owner:''},{id:'Y',minutes:7,owner:'甲'}]};
const draft={marker:input.marker,ids:['X','Y'],totalMinutes:10,unknownOwnerIds:['X','X']};
await writeFile(path.join(directory,'input.json'),JSON.stringify(input));
await writeFile(path.join(directory,'draft.json'),JSON.stringify(draft));
const events=[];let finish;
let approved=0;
const finished=new Promise(resolve=>{finish=resolve;});
const host=openCodexHost({executable,cwd:root,onRequest:async message=>{
 await writeFile(path.join(directory,`approval-request-${message.id}.json`),JSON.stringify(message,null,2),{flag:'wx'});
 if(approvalFlag!=='--approve-fixture-once'||approved||message.method!=='mcpServer/elicitation/request'||message.params.threadId!==threadId)return undefined;
 if(message.params.serverName!=='k_flash'||message.params.mode!=='form'||message.params._meta?.codex_approval_kind!=='mcp_tool_call'||Object.keys(message.params.requestedSchema?.properties??{}).length)return undefined;
 const item=events.findLast(e=>e.method==='item/started'&&e.params.item?.type==='mcpToolCall')?.params.item;
 if(item?.type!=='mcpToolCall'||item.server!=='k_flash'||item.tool!=='k_worker_start')return undefined;
 const args=item.arguments;
 assert.deepEqual(args,message.params._meta.tool_params);
 assert.equal(args.requestId,`main-${path.basename(directory)}`);
 assert.deepEqual(args.readFiles,[`${relative}/input.json`,`${relative}/draft.json`]);
 assert.deepEqual(args.outputFiles,[`${relative}/corrected.json`]);
 assert.ok(!args.coding&&!args.historyIds?.length);
 approved++;
 console.log('Approved one user-authorized fixture-only Flash call.');
 return {action:'accept',content:{}};
},onEvent(event){
 events.push(event);
 if(event.method==='item/completed'&&event.params.item?.type==='agentMessage')console.log(event.params.item.text);
 if(event.method==='turn/completed')finish(event.params);
}});
let threadId;let turnId;let timer;
try {
 await host.request('initialize',{clientInfo:{name:'k_harness',version:'0.1.0'}});host.notify({method:'initialized',params:{}});
 const account=await host.request('account/read',{refreshToken:false});
 assert.equal(account.account?.type,'chatgpt','Only existing ChatGPT subscription authentication is authorized.');
 const models=await host.request('model/list',{limit:100});assert.ok(models.data.some(m=>m.model===model));
 const started=await host.request('thread/start',{model,cwd:root,approvalPolicy:approvalFlag==='--approve-fixture-once'?'on-request':'never',sandbox:'read-only'});
 threadId=started.thread.id;
 await host.waitForMcp(threadId,'k_flash');
 const servers=await host.request('mcpServerStatus/list',{threadId,limit:100});
 await writeFile(path.join(directory,'mcp-status.json'),JSON.stringify(servers.data?.filter(s=>s.name==='k_flash'),null,2));
 await writeFile(path.join(directory,'session.json'),JSON.stringify({threadId,model,directory,accountType:'chatgpt',startedAt:new Date().toISOString()},null,2));
 console.log(JSON.stringify({directory,threadId,model:started.model,effort:started.reasoningEffort??null}));
 const task=[
  '這是使用者已授權的 K HARNESS 主控整合實測。你是 K 裡的主代理，不是工人。只處理下列人工非敏感案例，不讀其他任務或記憶、不呼叫其他代理。',
  `工作目錄 D:/K-harness；案例 ${relative}。你可唯讀該目錄 input.json 和 draft.json；不要自己編寫或執行修訂檔案。`,
  '驗收需求：marker 原樣；ids 保留全部輸入列、重複與順序；totalMinutes 為全部 minutes 總和；unknownOwnerIds 只包含 owner 嚴格等於 null 的列，空字串不算。',
  '先獨立讀回兩個檔案，判斷 draft 是否合格；若不合格，列出具體錯誤，使用原生 k_flash 的 k_worker_start 派 Flash 建立 corrected.json。你不能代工建立答案。',
  `派工 requestId 使用 main-${path.basename(directory)}；readFiles 僅 ["${relative}/input.json","${relative}/draft.json"]，outputFiles 僅 ["${relative}/corrected.json"]；task 明確要求修正并維持上述規則。已授權 DeepSeek API 呼叫。`,
  '派工後使用 k_worker_wait 事件等待，不短輪詢、不重送。完成後你自己唯讀 corrected.json 重算驗收。不可根據工人宣稱 completed 就接受。不要改任何來源或測試、不新增工具權限、不使用其他 MCP 或網路。',
  '最後回覆 JSON 物件：originalAccepted（布林）、issues（字串陣列）、correctedAccepted（布林）、verified（含 marker,ids,totalMinutes,unknownOwnerIds）。如果工具未提供或權限阻擋則明確說明，不繞過限制。',
 ].join('\n');
 timer=setTimeout(()=>{if(turnId)void host.request('turn/interrupt',{threadId,turnId}).catch(()=>{});finish({turn:{status:'timeout'}});},180000);
 const begun=await host.request('turn/start',{threadId,input:[{type:'text',text:task}]});turnId=begun.turn.id;
 const done=await Promise.race([finished,host.closed.then(()=>({turn:{status:'hostClosed'}}))]);clearTimeout(timer);
 await writeFile(path.join(directory,'events.json'),JSON.stringify(events,null,2));
 await writeFile(path.join(directory,'turn-result.json'),JSON.stringify(done,null,2));
 if(done.turn.status!=='completed')throw new Error('Main turn did not complete; inspect saved evidence without replay.');
 let corrected;
 try {corrected=JSON.parse(await readFile(path.join(directory,'corrected.json'),'utf8'));}catch(error){
   if(error.code==='ENOENT')throw new Error(`No corrected artifact; inspect ${directory}/events.json. No automatic retry.`);
   throw error;
 }
 assert.deepEqual(corrected,{marker:input.marker,ids:['X','X','Y'],totalMinutes:13,unknownOwnerIds:['X']});
 assert.deepEqual(JSON.parse(await readFile(path.join(directory,'input.json'))),input);
 assert.deepEqual(JSON.parse(await readFile(path.join(directory,'draft.json'))),draft);
 console.log(JSON.stringify({artifactVerified:true,directory,threadId,model,approved,parentSemanticReview:'pending'}));
} finally {clearTimeout(timer);await host.close();}
