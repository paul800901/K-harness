import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConversationController} from '../src/conversation-controller.mjs';
import {saveMainSession,listMainSessions} from '../src/main-sessions.mjs';
import {remoteRouteAllowed} from '../src/remote-access.mjs';

const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
const models=[{model:'gpt-6.1-sol',displayName:'Sol',provider:'codex'},{model:'claude-opus-5-5',displayName:'Opus',provider:'claude'},{model:'gemini-3.8-flash',displayName:'Flash',provider:'gemini'}].map(m=>({...m,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]}));
async function fixture({hold=false}={}){
 await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'discussion-rooms-'));let seq=0,answerPending;
 const owners=[],calls=[];
 const factory=({onChange})=>{
  const state={status:'idle',workspace:root,messages:[],workers:[],questions:[],queuedMessages:[],busy:false,usage:{},model:'gpt-6.1-sol',effort:'medium',accessMode:'workspace-write'};
  const c={state,closed:0,sent:[],async models(){return {models};},async selectWorkspace({path}){state.workspace=path;},async open(data){state.threadId=data.threadId??`room-${++seq}`;state.model=data.model;state.status='ready';await saveMainSession(root,state);onChange();return {threadId:state.threadId};},async workers(){return [];},async send(data){c.sent.push(data);state.messages.push({id:`native-${c.sent.length}`,role:'user',text:data.text});return {sent:true};},async stop(){state.busy=false;return {stopped:true};},async close(){c.closed++;},async metadata(data){await saveMainSession(root,{...state,...data});return data;},async selectModel(data){state.model=data.model;return data;}};owners.push(c);return c;
 };
 const c=createConversationController({root,sessionFactory:factory,discussionSessionFactory:async({selection,onIdentity})=>{
  await onIdentity({nativeSessionId:`discussion-${selection.id}`});return {async ask(prompt){calls.push({id:selection.id,prompt});if(selection.id==='host')return prompt.startsWith('你是多模型討論背景整理者')?'{"background":"需求與修正"}':'{"action":"finish","summary":"共識、分歧與未知都有保留。"}';if(hold)await new Promise((resolve,reject)=>{answerPending=reject;});return `${selection.model} 原始答案`;},async close(){answerPending?.(Error('stopped'));}};
 }});
 const a=await c.open({model:'gpt-6.1-sol'}),owner=owners.find(o=>o.state.threadId===a.threadId);
 const start=data=>c.discussionStart({...a,mode:'meeting',text:'議題',participants:[{model:'gpt-6.1-sol'},{model:'claude-opus-5-5',effort:'high'}],...data});
 return {root,c,a,owner,owners,calls,start};
}
const settled=async f=>{while(f.c.state.discussion?.busy)await new Promise(r=>setTimeout(r,5));};

test('all three discussion routes are available to the paired phone without expanding login or administration',()=>{
 for(const op of ['start','message','stop'])assert.equal(remoteRouteAllowed('POST',`/api/discussion/${op}`),true);
 assert.equal(remoteRouteAllowed('POST','/api/discussion/login'),false);
});

test('existing room directly starts a meeting, with no primary turn or extra sidebar/native registry rooms',async()=>{
 const f=await fixture();try{
  f.owner.state.messages.push({id:'original',role:'assistant',text:'原房意見'});await f.start();await settled(f);
  assert.equal(f.c.state.threadId,f.a.threadId);assert.equal(f.owner.sent.length,0);assert.equal((await listMainSessions(f.root)).sessions.length,1);
  assert.equal(f.c.state.messages[0].text,'原房意見');assert.equal(f.c.state.messages.filter(m=>m.model).length,2);
  assert.equal(f.owner.state.messages.length,1);assert.equal(f.c.state.discussion.status,'completed');
 }finally{await f.c.close();}
});

test('new empty room can begin with comparison, then cross-review without a forced pipeline',async()=>{
 const f=await fixture();try{await f.start({mode:'parallel',includeContext:false});await settled(f);assert.equal(f.owner.sent.length,0);assert.equal(f.c.state.discussion.mode,'parallel');await f.start({mode:'review',reviewTarget:'清楚的審查目標'});await settled(f);assert.equal(f.c.state.discussion.mode,'review');assert.equal(f.c.state.messages.filter(m=>m.summary).length,2);}finally{await f.c.close();}
});

test('ordinary continuation sends a visible handoff once and does not replace native room identity',async()=>{
 const f=await fixture();try{await f.start();await settled(f);await f.c.send({...f.a,text:'回到一般工作，只解釋尚未決定的取捨'});await f.c.send({...f.a,text:'下一題'});assert.match(f.owner.sent[0].text,/K 多模型討論交接/);assert.equal(f.owner.sent[1].text,'下一題');assert.equal(f.owner.state.threadId,f.a.threadId);}finally{await f.c.close();}
});

test('model effort choices come from the actual catalog, with no hard-coded tiers or silent replacement',async()=>{
 const f=await fixture();try{await assert.rejects(f.start({participants:[{model:'missing'},{model:'claude-opus-5-5'}]}),/原生清單/);await assert.rejects(f.start({participants:[{model:'gpt-6.1-sol',effort:'invented'},{model:'claude-opus-5-5'}]}),/推理程度/);assert.equal(f.calls.length,0);await f.start();await settled(f);assert.equal(f.c.state.discussion.participants[1].effort,'high');}finally{await f.c.close();}
});

test('an active native goal, queue, or approval prevents a new meeting without stopping or replaying it',async()=>{
 const f=await fixture();try{for(const extra of [{busy:true},{questions:[{id:'approval'}]},{queuedMessages:[{text:'waiting'}]},{capabilities:{goalContinuesWhileIdle:true},goal:{status:'active'}}]){const prior=structuredClone(f.owner.state);Object.assign(f.owner.state,extra);await assert.rejects(f.start(),/原工作/);Object.assign(f.owner.state,prior);for(const key of Object.keys(extra))if(!Object.hasOwn(prior,key))delete f.owner.state[key];}assert.equal(f.calls.length,0);}finally{await f.c.close();}
});
