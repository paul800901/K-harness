import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { runWorker } from '../src/worker.mjs';
import { createDeepSeekRuntime } from '../src/runtime.mjs';
import { inspectRecovery } from '../src/recovery.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const base=path.join(root,'.runtime/recovery-tests');
const [mode, argument, flag]=process.argv.slice(2);
const originalTask=[
  '人工非敏感的工作清單整理。讀 input.json，先建立 checkpoint.json，再建立 final.json 和 brief.md，必須依序完成。',
  '保留重複資料列，未知 owner 只能以嚴格 null 判斷，不猜身分，所有 ID 陣列保持原始順序。minutes 為有限非負數。不可改原始輸入。',
  'checkpoint.json 僅含 marker（原樣保留）、ids（所有列 ID）、totalMinutes（所有列加總）、doneMinutes（status=done 加總）、pendingIds（status=pending）、unknownOwnerIds（owner=null 的所有列）。',
  'final.json 僅含 marker、displayTitle、completedCount、pendingCount、totalMinutes、doneMinutes、pendingMinutes、pendingIds、unknownOwnerIds。displayTitle 預設「原始工作清單」。',
  'brief.md 用正體中文包含標題、總分鐘、完成分鐘、待辦分鐘、待辦 ID 與未知 owner ID；不能把未知 owner 猜成其他身分。',
  '只使用授權檔案工具。最後簡短交接，不自行宣稱主代理驗收。',
].join('\n');
if(mode==='prepare' && !argument) {
  await mkdir(base,{recursive:true});const directory=await mkdtemp(path.join(base,'case-'));
  const input={marker:randomUUID(),rows:[
    {id:'Z1',minutes:12,status:'done',owner:null},
    {id:'Z1',minutes:12,status:'done',owner:'甲'},
    {id:'P3',minutes:7,status:'pending',owner:null},
    {id:'D4',minutes:0,status:'done',owner:''},
    {id:'P5',minutes:5,status:'pending',owner:'乙'},
    {id:'D6',minutes:2,status:'done',owner:null},
  ]};
  await writeFile(path.join(directory,'input.json'),JSON.stringify(input,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(directory,'original-task.txt'),originalTask+'\n',{flag:'wx'});
  console.log(directory);
} else if(['interrupt','continue'].includes(mode) && argument && flag==='--live') {
  const directory=path.resolve(argument);
  const rel=path.relative(base,directory);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||(await lstat(directory)).isSymbolicLink())throw new Error('Use a prepared case directory.');
  const stateDir=path.join(directory,'jobs');const jobId=mode==='interrupt'?'interrupted':'continued';
  if(existsSync(path.join(stateDir,jobId)))throw new Error('Existing job: inspect; never replay automatically.');
  const apiKey=parseEnv((await readFile(path.join(root,'.env.local'),'utf8')).replace(/^\uFEFF/u,'')).DEEPSEEK_API_KEY;
  const runtime=await createDeepSeekRuntime('deepseek-v4-flash',apiKey);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),90000);
  let requests=0;const originalFetch=globalThis.fetch;
  globalThis.fetch=(resource,options)=>{
    const url=new URL(typeof resource==='string'||resource instanceof URL?resource:resource.url);
    if(url.origin!=='https://api.deepseek.com'||url.pathname!=='/chat/completions'||++requests>8)throw new Error('Bounded provider requests exceeded.');
    return originalFetch(resource,{...options,redirect:'error',signal:options?.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal});
  };
  const cancel=()=>controller.abort();process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  try {
    let task=await readFile(path.join(directory,'original-task.txt'),'utf8');
    let readFiles=['input.json'];let outputFiles=['checkpoint.json','final.json','brief.md'];
    if(mode==='continue') {
      const recovery=await inspectRecovery(path.join(stateDir,'interrupted'));
      assert.equal(recovery.status,'unresolved');
      const decision=JSON.parse(await readFile(path.join(directory,'handoff.json'),'utf8'));
      assert.equal(decision.previousProcessExited,true);
      assert.equal(decision.checkpointAccepted,true);
      // Compare against parent-reviewed bytes: this permits no edit or repeat of
      // the checkpoint. Approval is explicit host input, not a worker decision.
      assert.equal(await readFile(path.join(directory,'checkpoint.json'),'utf8'),decision.checkpointText);
      task=[
        '這是經主代理檢查後的新工人交接，不是重播原任務。舊程序已退出，checkpoint.json 已驗收且只能讀，不能重做。',
        '以下原任務僅用來恢復需求和限制：',recovery.originalTask,
        '本次只完成尚缺的 final.json 與 brief.md。先讀 input.json、已驗收 checkpoint.json 和 current-update.txt。current-update.txt 是主代理確認的最新修訂，標題須用新版，不用原任務舊標題。',
        '其餘原任務限制不變；若數字對不上就回報，不更改 checkpoint。',
      ].join('\n');
      readFiles=['input.json','checkpoint.json','current-update.txt'];outputFiles=['final.json','brief.md'];
    }
    const result=await runWorker({task,workspace:directory,readFiles,outputFiles,stateDir,jobId,...runtime,signal:controller.signal,
      onEvent(event){
        if(mode==='interrupt'&&event.type==='tool_execution_end'&&existsSync(path.join(directory,'checkpoint.json'))) {
          process.stdout.write('CONTROLLED_EXIT_AFTER_CHECKPOINT\n');
          // Real process termination before worker finally/saveJob. No mock status.
          process.exit(23);
        }
      },
    });
    console.log(JSON.stringify({directory:result.directory,status:result.status,modelTurns:result.modelTurns,toolCalls:result.toolCalls,toolErrors:result.toolErrors,requests}));
    if(mode==='interrupt'||result.status!=='completed')process.exitCode=1;
  } finally {clearTimeout(timer);globalThis.fetch=originalFetch;process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
} else {throw new Error('Use prepare, or interrupt/continue <prepared-case> --live.');}
