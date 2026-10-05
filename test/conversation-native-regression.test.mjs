import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConversationController } from '../src/conversation-controller.mjs';
import { createUnifiedController } from '../src/unified-controller.mjs';
import { createClaudeController } from '../src/claude-controller.mjs';
import { createDesktopController } from '../src/desktop-controller.mjs';

const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));
const claudeModel='claude-opus-5-5';

async function fixture(){
 await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'conversation-native-'));
 const codexHosts=[],claudeHosts=[];
 let codexId=0;
 const codexFactory=options=>{
  let resolveClosed;
  const host={options,closed:new Promise(resolve=>{resolveClosed=resolve;}),calls:[],
   notify(){},
   async request(method,params={}){
    this.calls.push({method,params});
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method==='model/list')return {data:[
     {model:'gpt-6-astra',displayName:'GPT-6 Astra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text']},
     {model:'gpt-6-luna',displayName:'GPT-6 Luna',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text']},
    ],nextCursor:null};
    if(method==='thread/start')return {thread:{id:`codex-room-${++codexId}`}};
    if(method==='thread/read')return {thread:{turns:[]}};
    if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
    if(method==='turn/start'){
     options.onEvent({method:'turn/started',params:{threadId:params.threadId,turn:{id:`turn-${params.threadId}`}}});
     return {turn:{id:`turn-${params.threadId}`}};
    }
    if(method==='turn/interrupt'){
     options.onEvent({method:'turn/completed',params:{threadId:params.threadId,turn:{id:params.turnId,status:'interrupted'}}});
     return {};
    }
    return {};
   },
   async close(){resolveClosed();},
  };
  codexHosts.push(host);return host;
 };
 const claudeFactory=options=>{
  let resolveClosed;
  const host={options,closed:new Promise(resolve=>{resolveClosed=resolve;}),startCalls:[],interruptCalls:0,closeCalls:0,
   async start(content){this.startCalls.push(content);},
   async interrupt(){this.interruptCalls++;},
   async close(){this.closeCalls++;resolveClosed();},
  };
  claudeHosts.push(host);return host;
 };
 const pool=createConversationController({root,executable:'fixture',commandSpec:{command:'claude-fixture',argsPrefix:[]},
  inspect:async()=>({available:true}),
  codexFactory:options=>createDesktopController({...options,hostFactory:codexFactory}),
  claudeFactory:options=>createClaudeController({...options,hostFactory:claudeFactory,
   bridgeFactory:async()=>({async list(){return [];},async close(){},async cancel(){return {settled:true};},async wait(){return {settled:true};},async inspect(){return {settled:true};}}),
   gatewayFactory:async()=>({mcpConfig:{mcpServers:{}},async close(){}}),
  }),
 });
 return {root,pool,codexHosts,claudeHosts};
}

test('two Claude conversations retain independent native hosts, stream, approval, completion, and stop',async()=>{
 const f=await fixture();
 try{
  const a=(await f.pool.open({model:claudeModel,accessMode:'claude-manual'})).threadId;
  await f.pool.send({threadId:a,text:'A stays running'});
  const hostA=f.claudeHosts.at(-1);
  const b=(await f.pool.open({model:claudeModel,accessMode:'claude-manual'})).threadId;
  await f.pool.send({threadId:b,text:'B stays running'});
  const hostB=f.claudeHosts.at(-1);
  assert.notEqual(a,b);
  assert.notEqual(hostA,hostB);
  assert.equal(hostA.closeCalls,0,'opening B must not close A native host');

  const streamA=event=>hostA.options.onMessage({type:'stream_event',event,parent_tool_use_id:null});
  streamA({type:'message_start',message:{id:'native-A-message',usage:{input_tokens:9,cache_read_input_tokens:0,cache_creation_input_tokens:0}}});
  streamA({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
  streamA({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'A background '}});
  streamA({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'stream'}});
  assert.equal(f.pool.state.messages.some(message=>message.text==='A background stream'),false);
  const approval=hostA.options.onPermission({toolName:'Bash',input:{command:'echo A'}});
  assert.equal(f.pool.state.threadId,b,'A background callbacks must not steal the visible conversation');
  assert.equal(f.pool.state.conversationActivity.find(row=>row.threadId===a).pendingQuestions,1);
  assert.equal(f.pool.state.conversationActivity.find(row=>row.threadId===b).pendingQuestions,0);

  await f.pool.stop({threadId:b});
  assert.equal(hostB.interruptCalls,1);
  assert.equal(hostA.interruptCalls,0,'stopping B must not interrupt A');
  assert.equal(hostA.closeCalls,0,'stopping B must not close A');

  await f.pool.open({threadId:a,model:claudeModel});
  assert.ok(f.pool.state.messages.some(message=>message.text==='A background stream'));
  assert.equal(f.pool.state.messages.at(-1).streaming,true);
  assert.equal(f.pool.state.progress.tokenUsage.last.totalTokens,9);
  assert.equal(f.pool.state.questions.length,1);
  const question=f.pool.state.questions[0];
  await f.pool.answer({threadId:a,id:question.id,accept:false});
  assert.deepEqual(await approval,{behavior:'deny',message:'使用者拒絕此工具呼叫。'});
  hostA.options.onMessage({type:'assistant',uuid:'a-assistant',message:{id:'native-A-message',content:[{type:'text',text:'A background stream'}]}});
  streamA({type:'message_stop'});
  hostA.options.onMessage({type:'result',is_error:false});
  assert.equal(f.pool.state.status,'completed');
  assert.equal(f.pool.state.threadId,a);
  assert.equal(f.pool.state.conversationActivity.find(row=>row.threadId===b).status,'interrupted');
 }finally{await f.pool.close();}
});

test('two Codex conversations route native events and interrupt only the selected thread',async()=>{
 const f=await fixture();
 try{
  const a=(await f.pool.open({model:'gpt-6-astra'})).threadId;
  await f.pool.send({threadId:a,text:'A request'});
  const hostA=f.codexHosts.at(-1);
  const b=(await f.pool.open({model:'gpt-6-astra'})).threadId;
  await f.pool.send({threadId:b,text:'B request'});
  const hostB=f.codexHosts.at(-1);
  assert.notEqual(a,b);
  assert.notEqual(hostA,hostB);

  hostA.options.onEvent({method:'item/agentMessage/delta',params:{threadId:a,itemId:'a-message',delta:'A background stream'}});
  const approval=hostA.options.onRequest({id:701,method:'item/commandExecution/requestApproval',params:{threadId:a,turnId:`turn-${a}`,itemId:'a-command',command:'echo A',cwd:f.root}});
  assert.equal(f.pool.state.threadId,b);
  assert.equal(f.pool.state.conversationActivity.find(row=>row.threadId===a).pendingQuestions,1);
  assert.equal(f.pool.state.conversationActivity.find(row=>row.threadId===b).pendingQuestions,0);

  await f.pool.stop({threadId:b});
  assert.equal(hostB.calls.filter(call=>call.method==='turn/interrupt').length,1);
  assert.equal(hostA.calls.filter(call=>call.method==='turn/interrupt').length,0);
  await f.pool.open({threadId:a,model:'gpt-6-astra'});
  assert.ok(f.pool.state.messages.some(message=>message.text.includes('A background stream')));
  const question=f.pool.state.questions[0];
  await f.pool.answer({threadId:a,id:question.id,accept:false});
  assert.deepEqual(await approval,{decision:'decline'});
  hostA.options.onEvent({method:'turn/completed',params:{threadId:a,turn:{id:`turn-${a}`,status:'completed'}}});
  assert.equal(f.pool.state.status,'completed');
  assert.equal(f.pool.state.threadId,a);
  assert.equal(f.pool.state.conversationActivity.find(row=>row.threadId===b).status,'interrupted');
 }finally{await f.pool.close();}
});

for(const provider of ['codex','claude'])test(`${provider} finishes A while B is selected without stealing focus, duplicating replies or resending`,async()=>{
 const f=await fixture(),model=provider==='codex'?'gpt-6-astra':claudeModel;
 try{
  const a=(await f.pool.open({model})).threadId;
  await f.pool.send({threadId:a,text:'A request'});
  const hostA=provider==='codex'?f.codexHosts.at(-1):f.claudeHosts.at(-1);
  const b=(await f.pool.open({model})).threadId;
  await f.pool.send({threadId:b,text:'B request'});
  const originalB=structuredClone(f.pool.state.messages),answer='A finished in the background';
  const complete=()=>{
   if(provider==='codex')hostA.options.onEvent({method:'turn/completed',params:{threadId:a,turn:{id:`turn-${a}`,status:'completed'}}});
   else hostA.options.onMessage({type:'result',is_error:false});
  };
  const finish=()=>{
   if(provider==='codex'){
    hostA.options.onEvent({method:'item/completed',params:{threadId:a,turnId:`turn-${a}`,item:{type:'agentMessage',id:'answer-a',text:answer}}});
   }else{
    hostA.options.onMessage({type:'assistant',uuid:'answer-a',message:{id:'answer-a',content:[{type:'text',text:answer}]}});
   }
   complete();
  };
  finish();
  // Codex publishes completion only after its asynchronous final worker readback.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.pool.state.threadId,b);
  assert.deepEqual(f.pool.state.messages,originalB,'A events must not contaminate visible B');
  assert.equal(f.pool.state.conversationActivity.find(room=>room.threadId===a).status,'completed');
  const attention=structuredClone(f.pool.state.completionAttention);
  assert.ok(attention.unread.some(room=>room.threadId===a),'background A completion remains unread');
  complete();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.pool.state.completionAttention,attention,'duplicate completion must not produce another notification');
  await f.pool.open({threadId:a,model});
  assert.equal(f.pool.state.messages.filter(message=>message.text===answer).length,1);
  assert.equal(provider==='codex'?hostA.calls.filter(call=>call.method==='turn/start').length:hostA.startCalls.length,1,'returning to A must not resend');
  await f.pool.open({threadId:b,model});
  assert.deepEqual(f.pool.state.messages,originalB);
 }finally{await f.pool.close();}
});
