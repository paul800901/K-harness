import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createDispatcher } from '../src/dispatcher.mjs';
import { createDeepSeekRuntime } from '../src/runtime.mjs';
import { createCodingTools } from '../src/coding.mjs';
import { readTranscript } from '../src/worker.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const base=path.join(root,'.runtime/mixed-tests');
const [mode,arg,flag]=process.argv.slice(2);
const originalCode=`export function summarize(rows) {
  const selected = [...new Map(rows.map(row => [row.id, row])).values()];
  return { count: selected.length, ids: selected.map(row => row.id),
    totalMinutes: selected.reduce((n, row) => n + Math.round(row.minutes), 0),
    unknownOwnerIds: selected.filter(row => !row.owner).map(row => row.id) };
}
`;
const check1=`import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './summary.mjs';
test('preserve duplicates and order',()=>assert.deepEqual(summarize([{id:'X',status:'done',minutes:2,owner:null},{id:'X',status:'queued',minutes:3,owner:'A'}]),{count:2,ids:['X','X'],totalMinutes:5,unknownOwnerIds:['X']}));
test('exclude paused by default',()=>assert.deepEqual(summarize([{id:'P',status:'paused',minutes:9,owner:null}]),{count:0,ids:[],totalMinutes:0,unknownOwnerIds:[]}));
test('strict null and fractional minutes',()=>assert.deepEqual(summarize([{id:'E',status:'done',minutes:0.25,owner:''},{id:'N',status:'queued',minutes:1.5,owner:null}]),{count:2,ids:['E','N'],totalMinutes:1.75,unknownOwnerIds:['N']}));
test('empty',()=>assert.deepEqual(summarize([]),{count:0,ids:[],totalMinutes:0,unknownOwnerIds:[]}));
`;
const check2=`import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './summary.mjs';
test('opt in paused, retain default',()=>{
 const rows=[{id:'P',status:'paused',minutes:2.25,owner:null},{id:'D',status:'done',minutes:0,owner:''}];
 assert.deepEqual(summarize(rows,true),{count:2,ids:['P','D'],totalMinutes:2.25,unknownOwnerIds:['P']});
 assert.equal(summarize(rows).count,1);
});
`;
const extra=`import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './summary.mjs';
test('parent independent matrix: duplicates, fractions, null and no input mutation',()=>{
 for(let n=0;n<41;n++)for(const includePaused of [false,true]) {
  const rows=Array.from({length:n},(_,i)=>Object.freeze({id:'R'+(i%5),status:['done','queued','paused'][i%3],minutes:(i%9)/4,owner:[null,'','Q'][i%3]}));
  Object.freeze(rows);
  const chosen=rows.filter(r=>includePaused||r.status!=='paused');
  assert.deepEqual(summarize(rows,includePaused),{count:chosen.length,ids:chosen.map(r=>r.id),totalMinutes:chosen.reduce((a,r)=>a+r.minutes,0),unknownOwnerIds:chosen.filter(r=>r.owner===null).map(r=>r.id)});
 }
});
`;
const load=async (dir,name)=>readFile(path.join(dir,name),'utf8');
const save=async (dir,name,value)=>writeFile(path.join(dir,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
function expected(rows,includePaused=false) {
 const selected=rows.filter(r=>includePaused||r.status!=='paused');
 return {count:selected.length,ids:selected.map(r=>r.id),totalMinutes:selected.reduce((n,r)=>n+r.minutes,0),unknownOwnerIds:selected.filter(r=>r.owner===null).map(r=>r.id)};
}
if(mode==='prepare'&&!arg) {
 await mkdir(base,{recursive:true});const dir=await mkdtemp(path.join(base,'case-'));
 const input={rows:Array.from({length:36},(_,i)=>({id:'W'+(i%11),status:['done','queued','paused'][i%3],minutes:(i%17)/4,owner:[null,'','甲','乙'][i%4]}))};
 const releaseCode=randomUUID();
 await save(dir,'input.json',input);await save(dir,'summary.mjs',originalCode);
 await save(dir,'checks-v1.mjs',check1);await save(dir,'checks-v2.mjs',check2);await save(dir,'parent-checks.mjs',extra);
 await save(dir,'initial-task.txt',[
  '第一階段：非敏感工作清單整理。先讀檔及執行測試重現錯誤，再修 summary.mjs 的 summarize(rows)，再測試並建立 draft.json。',
  'rows status 僅有 done、queued、paused；預設排除 paused。必須保留重複列、順序、小數分鐘，未知 owner 僅嚴格 null；不可修改輸入。',
  'summary 回傳 count、ids、totalMinutes、unknownOwnerIds；draft.json 僅含 title（初版工作清單）與 summary（以 input.json 的 rows 計算）。',
  `交付規約：此工作流的 releaseCode 為 ${releaseCode}。最終文件必須註明「僅供內部檢查，未對外發布」。此階段尚不建立最終文件。`,
  '你只可改 summary.mjs，測試與輸入不可變。只在全部指定測試通過後寫 draft.json。',
 ].join('\n'));
 await save(dir,'current-update.txt','第二階段明確修訂：summarize(rows, includePaused=false) 新增選用參數；true 時也納入 paused，省略或 false 必須保留既有行為。final.json.title 改為「含暫停項目的內部清單」，summary 以全部 rows 並 includePaused=true 計算。原交付規約仍有效，最終 releaseCode 與文件聲明請查第一階段歷史。保留 draft.json，不重建、不覆寫。\n');
 console.log(dir);
} else if(['stage1','stage2'].includes(mode)&&arg&&flag==='--live') {
 const dir=await realpath(arg);const rel=path.relative(base,dir);
 if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||(await lstat(arg)).isSymbolicLink())throw new Error('Use a prepared mixed case.');
 const stateDir=path.join(dir,'jobs');const requestId=mode;
 if(existsSync(path.join(stateDir,requestId)))throw new Error('Existing job: inspect, never replay.');
 const initial=await load(dir,'initial-task.txt');
 const inputText=await load(dir,'input.json');const input=JSON.parse(inputText);
 assert.equal(await load(dir,'checks-v1.mjs'),check1);assert.equal(await load(dir,'checks-v2.mjs'),check2);assert.equal(await load(dir,'parent-checks.mjs'),extra);
 if(mode==='stage1')assert.equal(await load(dir,'summary.mjs'),originalCode);
 const previous=mode==='stage2'?JSON.parse(await load(dir,'stage1-acceptance.json')):null;
 if(previous){assert.equal(previous.accepted,true);assert.equal(await load(dir,'draft.json'),previous.draftText);assert.equal(await load(dir,'summary.mjs'),previous.codeText);}
 const apiKey=parseEnv((await load(root,'.env.local')).replace(/^\uFEFF/u,'')).DEEPSEEK_API_KEY;
 const runtime=await createDeepSeekRuntime('deepseek-v4-flash',apiKey);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),120000);
 const originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=(resource,options)=>{
  const url=new URL(typeof resource==='string'||resource instanceof URL?resource:resource.url);
  if(url.origin!=='https://api.deepseek.com'||url.pathname!=='/chat/completions'||++requests>16)throw new Error('Bounded provider request limit.');
  return originalFetch(resource,{...options,redirect:'error',signal:options?.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal});
 };
 const host=await createDispatcher({workspace:dir,stateDir,...runtime});
 controller.signal.addEventListener('abort',()=>{void host.cancel(requestId);},{once:true});
 const started=Date.now();
 try {
  const reads=['input.json','summary.mjs','checks-v1.mjs',...(previous?['checks-v2.mjs','current-update.txt','draft.json']:[])];
  const tests=previous?['checks-v1.mjs','checks-v2.mjs']:['checks-v1.mjs'];
  await host.start({requestId,readFiles:reads,outputFiles:previous?['final.json','handoff.md']:['draft.json'],historyIds:previous?['stage1']:[],coding:{editFiles:['summary.mjs'],testFiles:tests},task:previous?[
   '這是整體工作流程第二階段，前一程序已結束、draft 已通過程式验收，保持原檔。本次是新 session，不重播第一階段。',
   '先讀 current-update.txt、目前程式及指定測試，查 stage1 歷史中的交付規約，依明確新需求修程式，保留舊功能；執行固定測試，通過後建立 final.json 與 handoff.md。',
   'final.json 僅含 title、summary、releaseCode。handoff.md 正體中文，含最新標題、總列數與總分鐘、原交付規約聲明、保留初稿的說明；不能聲稱主代理驗收或已發布。引用歷史來源 jobId/source。',
   '不修改任何測試或輸入，不新增相依或使用網路。',
  ].join('\n'):initial});
  let result=await host.wait(requestId);
  if(result.timedOut)result=await host.wait(requestId);
  assert.equal(result.status,'completed');
  await host.close(); // No running worker when parent inspects or starts a new process.
  assert.equal(await load(dir,'input.json'),inputText);assert.equal(await load(dir,'checks-v1.mjs'),check1);assert.equal(await load(dir,'checks-v2.mjs'),check2);
  const transcript=await readTranscript(result.directory);
  const tools=transcript.filter(e=>e.type==='message'&&e.message.role==='toolResult').map(e=>e.message);
  const testRuns=tools.filter(m=>m.toolName==='run_tests'&&!m.isError);
  assert.ok(testRuns.length>=1);assert.equal(testRuns.at(-1).details.status,'passed');
  const output=JSON.parse(await load(dir,previous?'final.json':'draft.json'));
  assert.deepEqual(output.summary,expected(input.rows,!!previous));
  assert.equal(output.title,previous?'含暫停項目的內部清單':'初版工作清單');
  if(previous) {
   assert.equal(await load(dir,'draft.json'),previous.draftText);
   assert.equal(output.releaseCode,initial.match(/releaseCode 為 ([a-f0-9-]+)/u)[1]);
   const handoff=await load(dir,'handoff.md');assert.match(handoff,/僅供內部檢查，未對外發布/u);
   assert.match(handoff,/含暫停項目的內部清單/u);assert.match(handoff,/stage1/u);
   assert.ok(tools.some(m=>m.toolName==='search_history'&&!m.isError));
   const evidence=path.join(dir,'parent-acceptance');await mkdir(evidence);
   const parentTools=await createCodingTools(dir,{editFiles:['summary.mjs'],testFiles:['parent-checks.mjs'],timeoutMs:10000},['summary.mjs','parent-checks.mjs'],evidence);
   const checked=await parentTools.find(t=>t.name==='run_tests').execute('parent',{});
   assert.equal(checked.details.status,'passed');
  }
  const usage=transcript.filter(e=>e.type==='message'&&e.message.role==='assistant').map(e=>e.message.usage).filter(Boolean);
  const report={accepted:true,acceptanceScope:'automated checks only; document semantics require independent parent review',stage:mode,directory:dir,jobDirectory:result.directory,elapsedMs:Date.now()-started,requests,toolCalls:result.toolCalls,toolErrors:result.toolErrors,searchCalls:tools.filter(m=>m.toolName==='search_history').length,testStatuses:testRuns.map(m=>m.details.status),usage,model:result.model,thinkingLevel:result.thinkingLevel,
   ...(previous?{draftPreserved:true,parentMatrixCases:82}:{draftText:await load(dir,'draft.json'),codeText:await load(dir,'summary.mjs')})};
  await save(dir,`${mode}-acceptance.json`,report);
  console.log(JSON.stringify({...report,usage:undefined,draftText:undefined,codeText:undefined},null,2));
 } finally {clearTimeout(timer);await host.close();globalThis.fetch=originalFetch;}
} else throw new Error('Use prepare, or stage1/stage2 <prepared-directory> --live.');
