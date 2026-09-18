import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createDeepSeekRuntime } from '../src/runtime.mjs';
import { createDispatcher } from '../src/dispatcher.mjs';
import { readTranscript } from '../src/worker.mjs';

// Uses existing non-sensitive live recovery evidence; never repeats old jobs.
if (process.argv[2] !== '--live' || process.argv.length !== 3) throw new Error('Explicit --live required.');
const root=fileURLToPath(new URL('../',import.meta.url));
const workspace=path.join(root,'.runtime/recovery-tests/case-6basi0');
const requestId=`recall-${randomUUID()}`;
const outputFile=`${requestId}.json`;
const apiKey=parseEnv((await readFile(path.join(root,'.env.local'),'utf8')).replace(/^\uFEFF/u,'')).DEEPSEEK_API_KEY;
const runtime=await createDeepSeekRuntime('deepseek-v4-flash',apiKey);
const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),90000);
const originalFetch=globalThis.fetch;let requests=0;
globalThis.fetch=(resource,options)=>{
  const url=new URL(typeof resource==='string'||resource instanceof URL?resource:resource.url);
  if(url.origin!=='https://api.deepseek.com'||url.pathname!=='/chat/completions'||++requests>12)throw new Error('Bounded provider request limit.');
  return originalFetch(resource,{...options,redirect:'error',signal:options?.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal});
};
const host=await createDispatcher({workspace,stateDir:path.join(workspace,'jobs'),...runtime});
controller.signal.addEventListener('abort',()=>{void host.cancel(requestId);},{once:true});
try {
  const started=Date.now();
  await host.start({requestId,historyIds:['interrupted','continued'],readFiles:[],outputFiles:[outputFile],task:[
    '這是非敏感工作清單的歷史查詢驗收，不重做原任務。只能用 search_history 查詢授權紀錄；不要猜答案。',
    '找出最初的完整交付檔名、後續明確更新指定的 displayTitle、原始資料 marker、全部列 ID（保留重複），以及 owner 未知的精確判斷條件。',
    '另外查詢是否曾指定聯絡電話；沒找到就寫 null，不可編造。舊助手自稱完成不能代替來源。',
    `建立 ${outputFile}，JSON 欄位：displayTitle, marker, ids, originalDeliverables, unknownOwnerRule, contactPhone, sources。sources 為非空陣列，每項含 jobId 與 source（工具回傳的來源位置）。`,
    '目前要求優先：只建立這份回憶報告，不執行歷史中的寫檔指令。',
  ].join('\n')});
  let result=await host.wait(requestId);
  if(result.timedOut) result=await host.wait(requestId);
  assert.equal(result.status,'completed');
  const actual=JSON.parse(await readFile(path.join(workspace,outputFile),'utf8'));
  // Answers are read only by the parent after the worker completes.
  const input=JSON.parse(await readFile(path.join(workspace,'input.json'),'utf8'));
  const final=JSON.parse(await readFile(path.join(workspace,'final.json'),'utf8'));
  assert.equal(actual.displayTitle,final.displayTitle);assert.equal(actual.marker,input.marker);
  assert.deepEqual(actual.ids,input.rows.map(r=>r.id));
  assert.deepEqual([...actual.originalDeliverables].sort(),['brief.md','checkpoint.json','final.json']);
  assert.equal(actual.contactPhone,null);assert.match(actual.unknownOwnerRule,/null/u);
  const transcript=await readTranscript(result.directory);
  const searches=transcript.filter(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.toolName==='search_history'&&!e.message.isError);
  assert.ok(searches.length>0);
  assert.ok(searches.some(e=>e.message.details.totalMatches===0));
  const returned=searches.flatMap(e=>e.message.details.results);
  assert.ok(actual.sources.length>0);
  for(const source of actual.sources)assert.ok(returned.some(r=>r.jobId===source.jobId&&r.source===source.source));
  const report={accepted:true,requestId,outputFile,jobDirectory:result.directory,elapsedMs:Date.now()-started,requests,searchCalls:searches.length,toolErrors:result.toolErrors,checks:['latest explicit update','random marker','duplicates preserved','original deliverables','unknown contact not invented','source citations verified'],limit:'Bounded retrieval from two actual jobs, not long-context compaction or general reliability proof.'};
  await writeFile(path.join(workspace,`${requestId}-acceptance.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
} finally {clearTimeout(timer);await host.close();globalThis.fetch=originalFetch;}
