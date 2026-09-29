import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {captureCompletedKnowledge,markSharedKnowledgeInjected,observeSharedKnowledge,retrieveSharedKnowledge,sharedKnowledgeFile,sharedKnowledgeIdsFromText,SHARED_KNOWLEDGE_INSTRUCTIONS} from '../src/shared-knowledge.mjs';

async function fixture(){await mkdir(path.join(process.cwd(),'.runtime/tests'),{recursive:true});const root=await mkdtemp(path.join(process.cwd(),'.runtime/tests/k-shared-'));const workspaceA=path.join(root,'project-a'),workspaceB=path.join(root,'project-b');await Promise.all([mkdir(workspaceA),mkdir(workspaceB)]);return {root,workspaceA,workspaceB,close:async()=>{}};}
const source=(provider,threadId,turnId,messageId,text,more={})=>observeSharedKnowledge({root:more.root,workspace:more.workspace??more.workspaceA,provider,threadId,turnId,messageId,text,sourceType:more.sourceType??'assistant',artifactRefs:more.artifactRefs??[]});

test('explicit remember request requires hidden metadata despite brief acknowledgement or tool prohibition while preserving exact-output and recall exceptions',()=>{
 assert.match(SHARED_KNOWLEDGE_INSTRUCTIONS,/explicitly asks you to remember, retain, save or capture[\s\S]*?required, not optional/i);
 assert.match(SHARED_KNOWLEDGE_INSTRUCTIONS,/visible reply is brief[\s\S]*?prohibits tools\/files[\s\S]*?not tool use/i);
 assert.match(SHARED_KNOWLEDGE_INSTRUCTIONS,/only recalling existing knowledge or asking a question/);
 assert.match(SHARED_KNOWLEDGE_INSTRUCTIONS,/explicitly forbids K metadata/);
 assert.match(SHARED_KNOWLEDGE_INSTRUCTIONS,/exact-output requirement explicitly applies to the entire assistant output/);
 assert.match(SHARED_KNOWLEDGE_INSTRUCTIONS,/past decisions or statements[\s\S]*?sourceQuote\/source excerpt and its provenance ID as evidence[\s\S]*?without searching a workspace/);
 assert.match(SHARED_KNOWLEDGE_INSTRUCTIONS,/does not prove the statement is true, current, or executed/);
 assert.match(SHARED_KNOWLEDGE_INSTRUCTIONS,/current state[\s\S]*?tools and authoritative-source checks remain available within existing permissions/);
});

test('native structured observations preserve provenance without recursively ingesting injected background or recall questions',async()=>{
 const f=await fixture();try{
  const text='請記住本專案的決定：紙鶴 R1 的發布通道採用青銅-742。只適用 Windows 離線 ZIP；Linux 未驗，因此否決全平台發布。';
  const item={subject:'紙鶴 R1 發布通道',kind:'decision',conclusion:'青銅-742；只適用 Windows 離線 ZIP；Linux 未驗，否決全平台發布。',sourceQuote:'紙鶴 R1 的發布通道採用青銅-742。只適用 Windows 離線 ZIP；Linux 未驗，因此否決全平台發布。',sourceRole:'user'};
  const common={root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'s',turnId:'t'};
  await captureCompletedKnowledge({...common,user:{id:'u',text,createdAt:'2026-09-28T01:00:00Z'},assistant:{id:'a',text:'已確認。\n<K_KNOWLEDGE_OBSERVATIONS>'+JSON.stringify([item])+'</K_KNOWLEDGE_OBSERVATIONS>'}});
  await captureCompletedKnowledge({...common,provider:'codex',threadId:'s2',turnId:'t2',user:{id:'u2',text:'紙鶴 R1 已決定什麼？\n\n<K_SHARED_KNOWLEDGE>'+text+'</K_SHARED_KNOWLEDGE>'},assistant:{id:'a2',text:'背景說青銅-742。'}});
  let doc=JSON.parse(await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8'));assert.equal(doc.records.length,1);assert.equal(doc.records[0].status,'user-stated');assert.equal(doc.records[0].source.kind,'user');assert.equal(doc.records[0].source.sourceAt,'2026-09-28T01:00:00Z');
  const corrected='更正紙鶴 R1 的發布通道：青銅-742 作廢，改用琥珀-916。仍不允許自動發布。';
  await captureCompletedKnowledge({...common,provider:'codex',threadId:'s3',turnId:'t3',user:{id:'u3',text:corrected,createdAt:'2026-09-28T01:02:00Z'},assistant:{id:'a3',text:'已更正。<K_KNOWLEDGE_OBSERVATIONS>'+JSON.stringify([{...item,kind:'correction',conclusion:'琥珀-916，青銅-742 作廢；仍不允許自動發布。',sourceQuote:corrected}])+'</K_KNOWLEDGE_OBSERVATIONS>'}});
  doc=JSON.parse(await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8'));assert.equal(doc.records.length,2);assert.equal(doc.records[0].active,false);assert.equal(doc.records[1].active,true);
  await captureCompletedKnowledge({...common,turnId:'bad',user:{id:'ub',text:'現在的設定是什麼？'},assistant:{id:'ab',text:'更正為猜測值。<K_KNOWLEDGE_OBSERVATIONS>'+JSON.stringify([{...item,kind:'correction',sourceQuote:'根本不存在的使用者來源'}])+'</K_KNOWLEDGE_OBSERVATIONS>'}});
  assert.equal(JSON.parse(await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8')).records.length,2);
 }finally{await f.close();}
});

test('off disables capture, duplicate sourceKeys stay idempotent, and explicit ids bypass lexical matching',async()=>{
 const f=await fixture();try{
  const common={root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'s',turnId:'t',user:{id:'u',text:'決定 發布通道使用青銅。'},assistant:{id:'a',text:'確認。'}};
  assert.equal((await captureCompletedKnowledge({...common,enabled:false})).saved,0);
  await assert.rejects(readFile(sharedKnowledgeFile(f.root,f.workspaceA)),{code:'ENOENT'});
  await captureCompletedKnowledge(common);await captureCompletedKnowledge(common);
  const doc=JSON.parse(await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8'));assert.equal(doc.records.length,1);
  const explicit=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:`請讀 record=${doc.records[0].id}`,provider:'claude',threadId:'s'});assert.equal(explicit.records.length,1);
 }finally{await f.close();}
});

test('Jev batches same-topic merge pair screening with reranking; score never changes sources',async()=>{
 const f=await fixture(),key=process.env.TYPESAFE_API_KEY;process.env.TYPESAFE_API_KEY='synthetic-test-key';
 try{
  await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'s',turnId:'t',text:'決定 發布通道使用青銅。'});
  const before=await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8');let calls=0;
  const r=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'更正 發布通道改用琥珀。',provider:'codex',threadId:'new',jevEnabled:true,fetchImpl:async(_url,init)=>{
   calls++;const body=JSON.parse(init.body),data=JSON.parse(body.state),candidate=data.candidates[0];assert.equal(candidate.candidateKey,'candidate_0');assert.match(candidate.sourceRecordId,/^[0-9a-f-]{36}$/);assert.equal('id' in candidate,false);assert.ok(body.questions.candidate_0.instructions.includes('candidateKey is "candidate_0"'));assert.ok(body.questions.candidate_0.instructions.includes('sourceRecordId is provenance only'));assert.ok(body.questions.pair_0.instructions.includes('candidateKey is "candidate_0"'));assert.ok(body.questions.pair_0.instructions.includes('sourceRecordId is provenance only'));return {ok:true,json:async()=>({answers:{candidate_0:{type:'noul',noul:0.9},pair_0:{type:'noul',noul:0.03}},usage:{input_tokens:30,output_tokens:5}})};
  }});
  assert.equal(calls,1);assert.equal(r.pairCount,1);assert.match(r.text,/same-topic=0.03/);assert.equal(r.records.length,1);assert.equal(await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8'),before);assert.deepEqual(r.jevUsage,{input_tokens:30,output_tokens:5});
 }finally{if(key===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=key;await f.close();}
});

test('decision and natural correction are source-linked, persisted, and old assertion leaves active recall',async()=>{
 const f=await fixture();try{
  await source('claude','claude-session-a','turn-a','assistant-a','決定 紙鶴發布通道是單一維護分支，僅在簽章驗證通過且 Linux 發佈完成後採用；Windows 簽章失敗時否決。',{...f});
  const initial=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'紙鶴發布通道的決定與否決條件？',provider:'codex',threadId:'codex-new'});
  assert.equal(initial.records.length,1);assert.match(initial.text,/Linux/);assert.match(initial.text,/Windows 簽章失敗時否決/);assert.match(initial.text,/claude-session-a\/turn-a\/assistant-a/);
  await source('codex','codex-session-b','turn-b','user-b','更正 紙鶴發布通道改為簽章檢查與 Windows/Linux 雙平台驗證都完成後才發布；兩平台任一失敗即否決。',{...f,sourceType:'user'});
  const after=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'紙鶴發布通道',provider:'claude',threadId:'claude-new'});
  assert.equal(after.records.length,1);assert.match(after.text,/Windows\/Linux 雙平台/);assert.doesNotMatch(after.text,/單一維護分支/);
  const data=JSON.parse(await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8'));
  assert.equal(data.records.length,2);assert.equal(data.records[0].active,false);assert.equal(data.records[1].relation.type,'supersedes');assert.equal(data.records[1].relation.recordId,data.records[0].id);
 }finally{await f.close();}
});

test('natural corrections pair on subject, preserve negation and conditions, and stale completion cannot replace newer knowledge',async()=>{
 const f=await fixture();try{
  await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'old',turnId:'t-old',messageId:'m-old',sourceType:'user',sourceAt:'2026-09-28T10:00:00Z',text:'決定 K HARNESS 的發布方式是單一維護分支；只有簽章驗證通過才發布，不使用未簽章封裝。'});
  await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'codex',threadId:'new',turnId:'t-new',messageId:'m-new',sourceType:'user',sourceAt:'2026-09-28T10:02:00Z',text:'更正 K HARNESS 的發布方式改為穩定分支；簽章驗證與 Linux 測試都通過後才發布，Windows 簽章失敗時不得發布。'});
  await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'late',turnId:'t-late',messageId:'m-late',sourceType:'user',sourceAt:'2026-09-28T10:01:00Z',text:'決定 K HARNESS 的發布方式是候選分支；條件仍須完整保留。'});
  const data=JSON.parse(await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8'));
  assert.equal(data.records.filter(row=>row.active).length,1);assert.match(data.records.find(row=>row.active).statement,/穩定分支/);assert.equal(data.records.at(-1).relation.stale,true);assert.match(data.records[0].sourceExcerpt,/不使用未簽章封裝/);
  const recalled=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'K HARNESS 發布方式 簽章 Linux Windows',provider:'codex',threadId:'fresh'});
  assert.equal(recalled.records.length,1);assert.match(recalled.text,/Linux 測試都通過後才發布/);assert.match(recalled.text,/Windows 簽章失敗時不得發布/);
 }finally{await f.close();}
});

test('project scope, duplicate source, and concurrent writes stay isolated',async()=>{
 const f=await fixture();try{
  const input={root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'same-thread',turnId:'same-turn',messageId:'same-message',text:'決定 匯出格式是 NDJSON；每列保留 source_id。'};
  const [a,b]=await Promise.all([observeSharedKnowledge(input),observeSharedKnowledge(input)]);assert.equal(a.saved+b.saved,1);
  await Promise.all(['甲','乙'].map((name,index)=>observeSharedKnowledge({...input,turnId:`parallel-${index}`,messageId:`m-${index}`,text:`決定 ${name} 工作流是保留原始事件。`})));
  assert.equal((await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'NDJSON source_id',provider:'codex',threadId:'new'})).records.length,1);
  assert.equal((await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceB,query:'NDJSON source_id',provider:'codex',threadId:'new'})).records.length,0);
  const data=JSON.parse(await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8'));assert.equal(data.records.length,3);
 }finally{await f.close();}
});

test('same thread does not reinject its own or already injected sources',async()=>{
 const f=await fixture();try{
  await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'source-thread',turnId:'source-turn',messageId:'source-message',text:'決定 色彩盤方案是紫色。'});
  const first=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'色彩盤方案',provider:'codex',threadId:'new-thread'});assert.equal(first.records.length,1);markSharedKnowledgeInjected({workspace:f.workspaceA,provider:'codex',threadId:'new-thread',records:first.records});
  assert.match(first.text,/可直接引用下方來源摘錄與來源 ID/);assert.match(first.text,/這不證明內容為真、目前仍有效或已執行/);assert.match(first.text,/若問題要求現況或摘錄缺少關鍵依據，仍可在既有權限內使用工具核實/);
  const repeat=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'色彩盤方案',provider:'codex',threadId:'new-thread'});assert.equal(repeat.records.length,0);
  const sameSource=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'色彩盤方案',provider:'claude',threadId:'source-thread'});assert.equal(sameSource.records.length,0);
 }finally{await f.close();}
});

test('ambiguous correction does not supersede either record or claim a proven conflict; revocation removes only unique match from recall',async()=>{
 const f=await fixture();try{
  for(const turnId of ['a','b'])await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'claude',threadId:`s-${turnId}`,turnId,messageId:`m-${turnId}`,text:`決定 備份策略是${turnId==='a'?'每週':'每月'}驗證快照。`});
  await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'codex',threadId:'s-c',turnId:'c',messageId:'m-c',sourceType:'user',text:'更正 備份策略改為每日驗證快照。'});
  let data=JSON.parse(await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8'));assert.equal(data.records.filter(x=>x.active).length,3);assert.equal(data.records.at(-1).unresolved,false);assert.equal(data.records.at(-1).relation,null);
  await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'s-e',turnId:'e',messageId:'m-e',text:'決定 舊有備份方案是手動檢查。'});
  await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'codex',threadId:'s-d',turnId:'d',messageId:'m-d',sourceType:'user',text:'撤銷 舊有備份方案。'});
  const revocation=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'舊有備份方案',provider:'claude',threadId:'new'});assert.equal(revocation.records.some(x=>x.subject==='舊有備份方案'&&x.kind!=='revocation'),false);assert.ok(revocation.records.some(x=>x.kind==='revocation'&&x.status==='withdrawn'));
 }finally{await f.close();}
});

test('six supported observations persist from a self-contained long source and fallback parsing reaches its end',async()=>{
 const f=await fixture();try{
  const facts=[
   {subject:'北極星 R7 發布管道',kind:'decision',conclusion:'Amber-284；僅 Windows 離線 ZIP；Linux 未驗證，否決全平台自動發布；選定管道不代表程式完成。',quote:'本次對北極星 R7 發布管道的正式定案為 Amber-284，僅適用 Windows 離線 ZIP。Linux 尚未驗證，因此全平台自動發布方案被否決。選定發布管道不代表程式已完成。'},
   {subject:'北極星 R7 備份保留期',kind:'decision',conclusion:'17 天；僅合成測試檔；60 天因 120 MB 上限否決。',quote:'本次對北極星 R7 備份保留期的正式定案為17天，僅適用合成測試檔。60天方案因120 MB測試容量上限而否決，不能套用到真實資料。'},
   {subject:'北極星 R7 告警條件',kind:'decision',conclusion:'連續 4 次失敗才待人工確認；單次失敗不發訊；無外部自動通知授權。',quote:'本次對北極星 R7 告警條件的正式定案為連續4次失敗才列入待人工確認；單次失敗不發訊。這不授權對外自動通知。'},
   {subject:'北極星 R7 驗收門檻',kind:'decision',conclusion:'47 筆固定樣本至少 45 筆正確且 0 越權；44/47 不通過，不得縮樣本。',quote:'本次對北極星 R7 驗收門檻的正式定案為47筆固定樣本至少45筆正確，而且必須0越權。44/47不能通過，也不准縮小樣本數。'},
   {subject:'北極星 R7 回復順序',kind:'decision',conclusion:'先停寫，再比對版本，最後還原霧銀-205；不能直接覆蓋原資料。',quote:'本次對北極星 R7 回復順序的正式定案為先停寫，再比對版本，最後還原霧銀-205。不能直接覆蓋原資料，也沒有宣稱已執行還原。'},
   {subject:'北極星 R7 模型權限',kind:'decision',conclusion:'只讀合成樣本並產生報告；不得上傳、購買或改正式檔；自動修補只是未授權提案。',quote:'本次對北極星 R7 模型權限的正式定案為只能讀取合成樣本與產生報告，不得上傳、購買或修改正式檔；子代理自動修補僅是未授權提案。'}
  ];
  const noise=Array.from({length:800},(_,i)=>`背景備忘${i}：標題相似不代表同一主題；這是供檢索測試使用的合成觀察，沒有新增決策或授權。`).join('\n\n');
  const sourceText=`${noise}\n\n${facts.map(f=>`【本段正式定案】\n${f.quote}`).join('\n\n')}`;assert.ok(sourceText.length>16000);
  const observations=facts.map(f=>({subject:f.subject,kind:f.kind,conclusion:f.conclusion,sourceQuote:f.quote,sourceRole:'user'}));
  const result=await captureCompletedKnowledge({root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'long-source',turnId:'long-turn',user:{id:'long-message',text:sourceText},assistant:{text:`<K_KNOWLEDGE_OBSERVATIONS>${JSON.stringify(observations)}</K_KNOWLEDGE_OBSERVATIONS>`}});
  assert.equal(result.saved,6);const data=JSON.parse(await readFile(sharedKnowledgeFile(f.root,f.workspaceA),'utf8'));assert.equal(data.records.length,6);
  for(const fact of facts){const record=data.records.find(row=>row.subject===fact.subject);assert.ok(record);assert.equal(record.sourceQuote,fact.quote);assert.equal(record.statement,fact.conclusion);assert.equal(record.sourceExcerpt.length,sourceText.length);}
  const longBody=`${'長文背景。'.repeat(3500)}\n決定 長文尾端測試項目是完整保留。`;const parsed=await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'codex',threadId:'long-tail',turnId:'tail-turn',text:longBody});assert.equal(parsed.saved,1);
 }finally{await f.close();}
});

test('original unprompted topic queries retrieve relevant source passages in sequence without replacing records or hiding conditions',async()=>{
 const f=await fixture();try{
  const facts=[
   {id:'release',subject:'北極星 R7 發布管道',statement:'Amber-284；僅 Windows 離線 ZIP；Linux 未驗證，否決全平台自動發布；管道選定不代表程式完成。',quote:'本次對北極星 R7 發布管道的正式定案為 Amber-284，僅適用 Windows 離線 ZIP。Linux 尚未驗證，因此全平台自動發布方案被否決。選定發布管道不代表程式已完成。'},
   {id:'backup',subject:'北極星 R7 備份保留期',statement:'17 天；僅合成測試檔；60 天因 120 MB 上限否決。',quote:'本次對北極星 R7 備份保留期的正式定案為17天，僅適用合成測試檔。60天方案因120 MB測試容量上限而否決，不能套用到真實資料。'},
   {id:'alert',subject:'北極星 R7 告警條件',statement:'連續 4 次失敗才待人工確認；單次失敗不發訊；無外部自動通知授權。',quote:'本次對北極星 R7 告警條件的正式定案為連續4次失敗才列入待人工確認；單次失敗不發訊。這不授權對外自動通知。'},
   {id:'acceptance',subject:'北極星 R7 驗收門檻',statement:'47 筆至少 45 正確且 0 越權；44/47 不通過，不得縮樣本。',quote:'本次對北極星 R7 驗收門檻的正式定案為47筆固定樣本至少45筆正確，而且必須0越權。44/47不能通過，也不准縮小樣本數。'},
   {id:'restore',subject:'北極星 R7 回復順序',statement:'先停寫，再比對版本，最後還原霧銀-205；不能直接覆蓋原資料。',quote:'本次對北極星 R7 回復順序的正式定案為先停寫，再比對版本，最後還原霧銀-205。不能直接覆蓋原資料，也沒有宣稱已執行還原。'},
   {id:'permissions',subject:'北極星 R7 模型權限',statement:'只讀合成樣本並產生報告；不得上傳、購買或改正式檔；自動修補僅是未授權提案。',quote:'本次對北極星 R7 模型權限的正式定案為只能讀取合成樣本與產生報告，不得上傳、購買或修改正式檔；子代理自動修補僅是未授權提案。'}
  ];
  const noise=Array.from({length:800},(_,i)=>`背景備忘${i}：相似的題名不是答案，這段只是檢索干擾，沒有決策。`).join('\n\n');
  const sourceText=`${noise}\n\n${facts.map(f=>`【本段正式定案】\n${f.quote}`).join('\n\n')}`;
  for(const fact of facts.filter(f=>['backup','alert','acceptance','permissions'].includes(f.id)))await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'legacy-source',turnId:`legacy-${fact.id}`,messageId:'legacy-message',sourceType:'assistant',text:sourceText,observations:[{kind:'decision',subject:fact.subject,statement:fact.statement,sourceText,sourceQuote:fact.quote}]});
  const noTools='這是合成測試。這是新的聊天室，不能假裝看過先前長文。請只根據本輪可見的來源背景回答；缺資料就逐項明說未知，不猜數字或補授權。不使用工具、不讀檔、不委派，不要求使用者重貼全文。';
  const queryA=`${noTools}\n請說明北極星 R7 發布管道的適用範圍、備份保留期與告警觸發及通知限制。每項請根據來源回答；沒有資訊就說未知。`;
  const queryB=`${noTools}\n請說明北極星 R7 驗收門檻、資料回復順序與目標版本；原始資料能否直接覆蓋？模型與子代理有哪些操作限制？沒有資訊就保留未知。`;
  const first=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:queryA,provider:'codex',threadId:'same-fresh-chat',jevEnabled:false});
   assert.match(first.text,/Amber-284/);assert.match(first.text,/Windows 離線 ZIP/);assert.match(first.text,/Linux 尚未驗證/);assert.match(first.text,/全平台自動發布方案被否決/);assert.match(first.text,/17天/);assert.match(first.text,/連續4次失敗/);assert.ok(first.records.filter(row=>row._sourceExcerptOnly).length>=1);
  assert.equal(first.records.some(row=>row.subject==='北極星 R7 發布管道'),false,'source lookup must not fabricate/persist an omitted record');
  markSharedKnowledgeInjected({workspace:f.workspaceA,provider:'codex',threadId:'same-fresh-chat',records:first.records});
  const second=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:queryB,provider:'codex',threadId:'same-fresh-chat',jevEnabled:false,alreadyInjectedIds:first.records.filter(row=>!row._sourceExcerptOnly).map(row=>row.id)});
   assert.match(second.text,/先停寫，再比對版本，最後還原霧銀-205/);assert.match(second.text,/不能直接覆蓋原資料/);assert.match(first.text+'\n'+second.text,/自動修補僅是未授權提案/);assert.ok(second.records.filter(row=>row._sourceExcerptOnly).length>=1,'a first excerpt must not block a second topic read');
  for(const result of [first,second]){const text=result.text,cjk=(text.match(/[\u3400-\u9fff]/g)??[]).length,latin=(text.match(/[A-Za-z0-9][A-Za-z0-9._/-]*/g)??[]).length;assert.ok(Math.ceil(cjk+latin*1.5+(text.length-cjk)*0.22)<=1500,'the fixed injection budget includes its source/provenance explanation');}
  const sourceIds=sharedKnowledgeIdsFromText(second.text);assert.ok(sourceIds.some(id=>id.startsWith('source-excerpt:')),'supplemental passage has its own read marker');assert.match(second.text,/source-record=[0-9a-f-]{36} source-excerpt=[0-9a-f]{32}/,'excerpt provenance distinguishes the source record from passage-level read state');
  const priorJevKey=process.env.TYPESAFE_API_KEY;process.env.TYPESAFE_API_KEY='synthetic-test-key';let jevPayload;let reranked;try{reranked=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:queryB,provider:'codex',threadId:'jev-excerpt-check',jevEnabled:true,fetchImpl:async(_url,init)=>{jevPayload=JSON.parse(init.body);const body=JSON.parse(jevPayload.state);return {ok:true,json:async()=>({answers:Object.fromEntries(body.candidates.map((candidate,i)=>[`candidate_${i}`,{noul:candidate.kind==='source-excerpt'&&!candidate.statement.includes('最後還原霧銀-205')?0.99:0.01}]))})};}});}finally{if(priorJevKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=priorJevKey;}
  const state=JSON.parse(jevPayload.state);assert.ok(state.candidates.some((row,index)=>row.candidateKey===`candidate_${index}`&&/^[0-9a-f-]{36}$/.test(row.sourceRecordId)&&!('id' in row)));const excerptIndex=state.candidates.findIndex(row=>row.kind==='source-excerpt'&&row.statement.includes('不能直接覆蓋原資料'));assert.ok(excerptIndex>=0);assert.ok(jevPayload.questions[`candidate_${excerptIndex}`].instructions.includes(`candidateKey is "candidate_${excerptIndex}"`));assert.ok(jevPayload.questions[`candidate_${excerptIndex}`].instructions.includes('exact source excerpt'));assert.match(reranked.text,/不能直接覆蓋原資料/,'a highly scored weak indexed candidate must not push a lower-scored relevant excerpt outside the source-backed context');
  const release=facts.find(x=>x.id==='release'),backup=facts.find(x=>x.id==='backup');
  await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'codex',threadId:'correction',turnId:'correction-turn',messageId:'correction-message',sourceType:'user',text:'更正北極星 R7 發布管道：先前 Amber-284 作廢，改用 Silver-931；Linux 未驗證，因此仍否決全平台自動發布。撤銷北極星 R7 備份保留期原先 17 天，新天數尚未決定，不能猜成 7 天。',observations:[
   {kind:'correction',subject:release.subject,statement:'Silver-931；Windows 離線 ZIP；Linux 未驗證，否決全平台自動發布。',sourceText:'更正北極星 R7 發布管道：先前 Amber-284 作廢，改用 Silver-931；Linux 未驗證，因此仍否決全平台自動發布。',sourceQuote:'更正北極星 R7 發布管道：先前 Amber-284 作廢，改用 Silver-931；Linux 未驗證，因此仍否決全平台自動發布。'},
   {kind:'revocation',subject:backup.subject,statement:'17 天已撤銷；新天數尚未決定，不能猜成 7 天。',sourceText:'撤銷北極星 R7 備份保留期原先 17 天，新天數尚未決定，不能猜成 7 天。',sourceQuote:'撤銷北極星 R7 備份保留期原先 17 天，新天數尚未決定，不能猜成 7 天。'}
  ]});
  const corrected=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'北極星 R7 Amber-284 發布管道 Silver-931',provider:'claude',threadId:'corrected-release'});assert.match(corrected.text,/Silver-931/);assert.match(corrected.text,/Amber-284 作廢/);assert.doesNotMatch(corrected.text,/來源摘錄：本次對北極星 R7 發布管道的正式定案為 Amber-284/);
  const revoked=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'北極星 R7 備份 17 天 保留期',provider:'claude',threadId:'revoked-backup'});assert.match(revoked.text,/17 天已撤銷/);assert.match(revoked.text,/新天數尚未決定/);assert.doesNotMatch(revoked.text,/來源摘錄：本次對北極星 R7 備份保留期的正式定案為17天/);
  const stillAvailable=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:queryB,provider:'claude',threadId:'unaffected-recovery'});assert.match(stillAvailable.text,/最後還原霧銀-205/);assert.match(stillAvailable.text,/不能直接覆蓋原資料/);
 }finally{await f.close();}
});

test('reopened passage markers do not mark the unrelated linked record as injected',()=>{
 const record='56aa309b-6509-43cf-bee1-13ca508a8900',excerpt='9ae193d6a88f395ebbf9b6a83850897c';
 assert.deepEqual(sharedKnowledgeIdsFromText(`source-record=${record} source-excerpt=${excerpt}`),[`source-excerpt:${excerpt}`]);
 assert.deepEqual(sharedKnowledgeIdsFromText(`record=${record}`),[record]);
});

test('automatic completion observation stores native artifact provenance without transcript text',async()=>{
 const f=await fixture();try{
  const result=await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'codex',threadId:'c1',turnId:'t1',messageId:'m1',text:'一般完成回覆沒有耐久決策。',artifactRefs:['docs/result.md']});
  assert.equal(result.saved,1);const [record]=(await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'result.md artifact',provider:'claude',threadId:'c2'})).records;
  assert.equal(record.kind,'observation');assert.equal(record.status,'source-event');assert.match(record.statement,/docs\/result.md/);assert.doesNotMatch(record.statement,/一般完成回覆/);
 }finally{await f.close();}
});

test('Jev is opt-in, bounded, no-retry, and falls back to local recall on missing key or failures',async()=>{
 const f=await fixture();const originalEnabled=process.env.K_JEV_ENABLED,originalKey=process.env.TYPESAFE_API_KEY;
 try{
  await observeSharedKnowledge({root:f.root,workspace:f.workspaceA,provider:'claude',threadId:'c',turnId:'t',messageId:'m',text:'決定 閘門測試通道是隔離候選。'});
  delete process.env.K_JEV_ENABLED;delete process.env.TYPESAFE_API_KEY;
  let calls=0;let result=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'閘門測試通道',provider:'codex',threadId:'new',fetchImpl:async()=>{calls++;throw Error('unexpected');}});assert.equal(result.mode,'disabled');assert.equal(calls,0);assert.equal(result.records.length,1);
  process.env.K_JEV_ENABLED='true';result=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'閘門測試通道',provider:'codex',threadId:'new',fetchImpl:async()=>{calls++;throw Error('unexpected');}});assert.equal(result.mode,'missing-key');assert.equal(calls,0);assert.equal(result.records.length,1);
  process.env.TYPESAFE_API_KEY='test-key';let requests=0;
  result=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'閘門測試通道',provider:'codex',threadId:'new',fetchImpl:async(url,init)=>{requests++;assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(init.method,'POST');const body=JSON.parse(init.body);assert.equal(body.model,'jev-1.13.0');assert.match(body.questions.candidate_0.instructions,/record entry .*閘門測試通道/);assert.deepEqual(body.questions.candidate_0.criteria,{true:'This specific candidate is relevant background to the query',false:'This specific candidate is not relevant background to the query'});return {ok:true,json:async()=>({answers:{candidate_0:{noul:0.91}}})};}});assert.equal(result.mode,'jev');assert.equal(requests,1);
  result=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'閘門測試通道',provider:'codex',threadId:'new',fetchImpl:async()=>{requests++;return {ok:false,status:503};}});assert.equal(result.mode,'local-fallback');assert.equal(result.records.length,1);assert.equal(requests,2);
  result=await retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'閘門測試通道',provider:'codex',threadId:'new',jevTimeoutMs:5,fetchImpl:(_url,init)=>{requests++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));}});assert.equal(result.mode,'local-fallback');assert.equal(result.records.length,1);assert.equal(requests,3);
  const controller=new AbortController();controller.abort(new DOMException('cancelled','AbortError'));await assert.rejects(retrieveSharedKnowledge({root:f.root,workspace:f.workspaceA,query:'閘門測試通道',provider:'codex',threadId:'new',signal:controller.signal,fetchImpl:async()=>{throw Error('must not run');}}),/cancelled/);
 }finally{if(originalEnabled===undefined)delete process.env.K_JEV_ENABLED;else process.env.K_JEV_ENABLED=originalEnabled;if(originalKey===undefined)delete process.env.TYPESAFE_API_KEY;else process.env.TYPESAFE_API_KEY=originalKey;await f.close();}
});
