import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDiscussionController} from '../src/discussion-controller.mjs';
import {discussionDecision} from '../shared/discussion.mjs';

const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const participants=[{id:'p1',model:'gpt-6.1-sol',displayName:'Sol',effort:'medium'},{id:'p2',model:'claude-opus-5-5',displayName:'Opus',effort:'high'}];
async function fixture({decisions=[{action:'finish',summary:'共識：目標清楚。分歧：保留 Sol 與 Opus 不同主張。未知：待查證。'}],answer,closeFailure=false}={}){
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'discussion-'));
 const calls=[],opened=[],created=deferred();
 const factory=async({selection,onIdentity,signal})=>{
  const id=selection.id;opened.push(id);await onIdentity({model:selection.model,nativeSessionId:`native-${id}`});created.resolve();
  return {async ask(prompt,{onText=()=>{}}={}){
   calls.push({id,prompt});signal.throwIfAborted();
   const response=id==='host'?prompt.startsWith('你是多模型討論背景整理者')?JSON.stringify({background:'使用者修正後的背景與需求，未把舊模型結論當真值。'}):JSON.stringify(decisions.shift()):`${selection.displayName} 的獨立意見`;
   const output=answer?await answer({id,prompt,response}):response;onText(output);return output;
  },async close(){if(closeFailure)throw Error('未確認停止');}};
 };
 const d=createDiscussionController({root,threadId:'room',sessionFactory:factory});await d.load();
 const start=fields=>d.start({mode:'meeting',text:'議題',participants,facilitator:{...participants[0],id:'host'},workspace:root,source:[{role:'user',text:'請保留修正與限制。'},{role:'assistant',text:'舊模型答案'}],afterMessageId:'old',...fields});
 return {d,root,calls,opened,start,created};
}

test('discussion instruction contract accepts useful decisions and rejects nonexistent participants without retries',()=>{
 assert.equal(discussionDecision('```json\n{"action":"finish","summary":"共識與分歧"}\n```',participants).action,'finish');
 for(const text of ['bad JSON','{"action":"speak","speakers":[],"prompt":"x"}','{"action":"speak","speakers":["p3"],"prompt":"x"}','{"action":"speak","speakers":["p1","p1"],"prompt":"x"}'])assert.throws(()=>discussionDecision(text,participants));
});

test('parallel participants receive identical materials but never each other\'s current answers',async()=>{
 const f=await fixture();await f.start({mode:'parallel'});await f.d.settled();
 assert.equal(f.d.state.status,'completed');
 const answers=f.calls.filter(c=>c.id!=='host');assert.equal(answers.length,2);
 const material=c=>JSON.parse(c.prompt.split('討論資料：')[1]);assert.deepEqual(material(answers[0]),material(answers[1]));
 assert.equal(Object.hasOwn(material(answers[0]),'discussion'),false);
 assert.match(f.calls[0].prompt,/不得加入原模型的候選答案/);
 assert.match(f.d.messages.at(-1).text,/分歧/);assert.deepEqual(f.opened.sort(),['host','p1','p2']);
});

test('meeting AI can schedule selected speakers repeatedly without a fixed-round template',async()=>{
 const f=await fixture({decisions:[{action:'speak',speakers:['p2'],prompt:'請 Opus 回應 Sol 的具體分歧'},{action:'speak',speakers:['p1'],prompt:'請 Sol 回應 Opus 的理由'},{action:'speak',speakers:['p2'],prompt:'只回答仍未清楚的證據'},{action:'finish',summary:'不同意見仍成立，不必一致。'}]});
 await f.start();await f.d.settled();assert.equal(f.d.state.status,'completed');
 assert.deepEqual(f.calls.filter(c=>c.id!=='host').map(c=>c.id),['p1','p2','p2','p1','p2']);
 const cross=f.calls.find(c=>c.prompt.includes('請 Opus 回應 Sol 的具體分歧'));assert.match(cross.prompt,/Sol 的獨立意見/);assert.match(cross.prompt,/Opus 的獨立意見/);
});

test('review requires a concrete target and forwards it to independent reviewers',async()=>{
 const f=await fixture();await assert.rejects(f.start({mode:'review'}),/被審查內容/);assert.equal(f.opened.length,0);
 await f.start({mode:'review',reviewTarget:'需要审查的方案原文'});await f.d.settled();
 for(const c of f.calls.filter(c=>c.id!=='host')){assert.match(c.prompt,/需要审查的方案原文/);assert.match(c.prompt,/獨立審查指定目標/);}
});

test('fresh context excludes earlier answers; prepared background remains human-readable',async()=>{
 const f=await fixture();await f.start({includeContext:false});await f.d.settled();assert.equal(f.calls[0].prompt.includes('舊模型答案'),false);
 assert.ok(f.d.messages.some(m=>m.background&&m.text.includes('使用者修正')));
});

test('an interjection during host completion invalidates its stale finish and reaches the named participant',async()=>{
 const gate=deferred(),hostDeciding=deferred();let n=0;
 const f=await fixture({decisions:[{action:'finish',summary:'過時整理'},{action:'finish',summary:'已處理新的修正，保留不同意見'}],answer:async({id,prompt,response})=>{if(id==='host'&&prompt.startsWith('你是主持人')&&++n===1){hostDeciding.resolve();await gate.promise;}return response;}});
 await f.start();await hostDeciding.promise;await f.d.interject({text:'請 Opus 只釐清這點，不要重做 Sol',target:'p2'});gate.resolve();await f.d.settled();
 assert.equal(f.d.messages.some(m=>m.summary&&m.text==='過時整理'),false);
 assert.equal(f.calls.filter(c=>c.id==='p1').length,1);assert.equal(f.calls.filter(c=>c.id==='p2').length,2);
 assert.ok(f.calls.filter(c=>c.id==='p2').at(-1).prompt.includes('不要重做 Sol'));
});

test('a normal interjection is kept verbatim for AI arrangement, not forced into every speaker',async()=>{
 const gate=deferred(),ready=deferred();let n=0;
 const f=await fixture({decisions:[{action:'finish',summary:'stale'},{action:'speak',speakers:['p1'],prompt:'只需 Sol 回應使用者的新限制'},{action:'finish',summary:'回應完成，有分歧保留'}],answer:async({id,prompt,response})=>{if(id==='host'&&prompt.startsWith('你是主持人')&&++n===1){ready.resolve();await gate.promise;}return response;}});
 await f.start();await ready.promise;await f.d.interject({text:'新的重要限制原文'});gate.resolve();await f.d.settled();
 assert.ok(f.calls.filter(c=>c.id==='host').at(-1).prompt.includes('新的重要限制原文'));assert.equal(f.calls.filter(c=>c.id==='p2').length,1);
});

test('participant failure preserves independent peer output and blocks dependent rounds; no replacement or replay',async()=>{
 const f=await fixture({answer:({id,response})=>{if(id==='p2')throw Error('官方額度不足');return response;}});
 await f.start();await f.d.settled();assert.equal(f.d.state.status,'failed');assert.match(f.d.state.error,/額度不足/);
 assert.equal(f.calls.filter(c=>c.id==='p2').length,1);assert.ok(f.d.messages.some(m=>m.speaker==='Sol'&&!m.partial));assert.ok(f.d.messages.some(m=>m.speaker==='Opus'&&m.partial));
});

test('malformed host output ends visibly without retrying or silently switching models',async()=>{
 const f=await fixture({decisions:[{action:'speak',speakers:['not-real'],prompt:'bad'}]});await f.start();await f.d.settled();
 assert.equal(f.d.state.status,'failed');assert.match(f.d.state.error,/調度指令/);assert.equal(f.calls.filter(c=>c.id==='host').length,2);
});

test('failed session teardown is uncertain, never completed or silently restarted',async()=>{
 const f=await fixture({closeFailure:true});await f.start();await f.d.settled();assert.equal(f.d.state.status,'uncertain');await assert.rejects(f.start(),/狀態待確認/);
});

test('same-room start is reserved before asynchronous persistence, preventing two hosts',async()=>{
 const f=await fixture();const first=f.start();await assert.rejects(f.start(),/尚未結束/);await first;await f.d.settled();assert.equal(f.opened.filter(id=>id==='host').length,1);
});

test('history overlays stay in the original room and keep all model contributions visible across normal continuation',async()=>{
 const f=await fixture();await f.start();await f.d.settled();const original=[{id:'old',role:'assistant',text:'原回覆'},{id:'later',role:'user',text:'後續一般指示'}];
 const view=f.d.project(original);assert.equal(view[0].text,'原回覆');assert.equal(view.at(-1).text,'後續一般指示');assert.equal(view.filter(m=>m.model).length,2);assert.equal(original.length,2);
 const reopened=createDiscussionController({root:f.root,threadId:'room',sessionFactory:()=>{throw Error('must not open on readback');}});await reopened.load();assert.deepEqual(reopened.project(original),view);
});

test('ordinary continuation gets an explicit, once-attempted handoff with all original opinions',async()=>{
 const f=await fixture();await f.start();await f.d.settled();const handoff=await f.d.handoff('請討論實作');assert.match(handoff.text,/不是本模型的原生歷史/);assert.match(handoff.text,/Sol 的獨立意見/);assert.match(handoff.text,/Opus 的獨立意見/);
 assert.equal((await f.d.handoff('下一題')).text,'下一題');await handoff.rejected();assert.match((await f.d.handoff('已確認未送出，改送')).text,/新增討論原文/);
});

test('interrupted persisted run reads back uncertain without opening sessions or replaying work',async()=>{
 const f=await fixture();await f.start();await f.d.settled();const file=path.join(f.root,'.runtime/discussions/room.json'),record=JSON.parse(await readFile(file,'utf8'));record.runs.at(-1).status='working';await writeFile(file,JSON.stringify(record));
 let opened=0;const reopened=createDiscussionController({root:f.root,threadId:'room',sessionFactory:()=>{opened++;}});await reopened.load();assert.equal(reopened.state.status,'uncertain');assert.equal(opened,0);await assert.rejects(reopened.stop(),/不能冒稱/);
});

test('stop waits for all already opened sessions and cancels unsent scheduling',async()=>{
 const waiting=deferred(),started=deferred();const f=await fixture();let closes=0;
 const d=createDiscussionController({root:f.root,threadId:'stop-room',sessionFactory:async({selection,signal})=>({async ask(){if(selection.id==='host')return '{"background":"假資料"}';started.resolve();return waiting.promise;},async close(){closes++;waiting.reject(Error('native stopped'));}})});
 await d.load();await d.start({mode:'meeting',text:'測試停止',participants,facilitator:{...participants[0],id:'host'},workspace:f.root});await started.promise;const stopped=await d.stop();assert.equal(stopped.stopped,true);assert.equal(d.state.status,'interrupted');assert.ok(closes>=3);assert.equal(d.messages.some(m=>m.summary),false);
});
