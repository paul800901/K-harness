import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startDesktop} from '../src/desktop-server.mjs';
import {createStateStream,applyStateEvent} from '../shared/state-stream.mjs';

const stateWith = (messages=[],tools=[]) => ({status:'working',busy:true,progress:{plan:[]},messages,tools});

test('snapshots on connect/reconnect resynchronize state', () => {
  const stream=createStateStream();
  const state=stateWith([{id:'m1',role:'assistant',text:'one'}]);
  let client=applyStateEvent(null,stream.snapshot(state));
  state.messages[0].text+=' two';
  client=applyStateEvent(client,stream.update(state));
  assert.equal(client.messages[0].text,'one two');
  // A reconnect receives a fresh complete snapshot, not a dependent patch.
  const reconnected=applyStateEvent(null,stream.snapshot(state));
  assert.deepEqual(reconnected,state);
});

test('legacy bare full-state events remain readable during the server transition', () => {
  const legacy={status:'ready',messages:[{id:'m1',role:'assistant',text:'legacy'}],tools:[],busy:false};
  const restored=applyStateEvent(null,legacy);
  assert.deepEqual(restored,legacy);
  assert.notEqual(restored,legacy);
  assert.notEqual(restored.messages,legacy.messages);

  // Compatibility must not reinterpret typed snapshots or patches.
  const stream=createStateStream();
  const typedSnapshot=stream.snapshot({status:'ready',messages:[],tools:[]});
  assert.equal(typedSnapshot.type,'snapshot');
  assert.deepEqual(applyStateEvent(null,typedSnapshot),typedSnapshot.state);
  const patch=stream.update({status:'working',messages:[],tools:[]});
  assert.equal(patch.type,'patch');
  assert.equal(applyStateEvent({status:'ready',messages:[],tools:[]},patch).status,'working');
});

test('mutated messages and tools stream compact append patches without drift', () => {
  const stream=createStateStream();
  const state=stateWith([{id:'m1',role:'assistant',text:'hello'}],[{id:'t1',name:'shell',status:'running',output:'abc'}]);
  let client=applyStateEvent(null,stream.snapshot(state));
  state.messages[0].text+=' world';
  state.tools[0].output+=' def';
  const event=stream.update(state);
  assert.equal(event.changes.messages.upsert[0].op,'append');
  assert.equal(event.changes.tools.upsert[0].op,'append');
  client=applyStateEvent(client,event);
  assert.deepEqual(client,state);
});

test('removal and reordering are represented and applied', () => {
  const stream=createStateStream();
  const state=stateWith([{id:'a',role:'user',text:'A'},{id:'b',role:'assistant',text:'B'}],[{id:'x',output:'x'},{id:'y',output:'y'}]);
  let client=applyStateEvent(null,stream.snapshot(state));
  state.messages.splice(0,1);state.messages.reverse();
  state.tools.splice(0,1);state.tools.reverse();
  const event=stream.update(state);
  assert.deepEqual(event.changes.messages.remove,['a']);
  assert.deepEqual(event.changes.messages.order,['b']);
  assert.deepEqual(event.changes.tools.remove,['x']);
  client=applyStateEvent(client,event);
  assert.deepEqual(client,state);
});

test('a second SSE client receives a snapshot only after pending changes reach the first client', async () => {
  const root=await mkdtemp(path.join(fileURLToPath(new URL('../.runtime/tests/',import.meta.url)),'sse-reconnect-'));
  const state={status:'ready',messages:[{id:'m1',role:'assistant',text:'before'}],tools:[]};let notify;
  const app=await startDesktop({root,executable:'fixture',port:0,controllerFactory:({onChange})=>{notify=onChange;return {state,close:async()=>{}};}});
  const streams=[];
  async function connect(){
    const home=await fetch(app.origin);const cookie=home.headers.get('set-cookie').split(';')[0];
    const response=await fetch(new URL('/api/events',app.origin),{headers:{cookie}});
    const reader=response.body.getReader();streams.push(reader);const decoder=new TextDecoder();let buffer='';
    return {read:async()=>{while(!buffer.includes('\n\n')){const part=await reader.read();if(part.done)throw Error('SSE ended before an event');buffer+=decoder.decode(part.value,{stream:true});}const end=buffer.indexOf('\n\n'),frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split('\n').find(line=>line.startsWith('data: '));return JSON.parse(data.slice(6));}};
  }
  try{
    const first=await connect();assert.equal((await first.read()).type,'snapshot');
    state.messages[0].text+=' after';notify();await new Promise(resolve=>setTimeout(resolve,10));
    const second=await connect();const snapshot=await second.read();
    assert.equal(snapshot.type,'snapshot');assert.equal(snapshot.state.messages[0].text,'before after');
    const patch=await first.read();assert.equal(patch.type,'patch');assert.equal(patch.changes.messages.upsert[0].op,'append');
    const restored=applyStateEvent({status:'ready',messages:[{id:'m1',role:'assistant',text:'before'}],tools:[]},patch);
    assert.equal(restored.messages[0].text,'before after');
  }finally{for(const reader of streams)await reader.cancel().catch(()=>{});await app.close();}
});

test('benchmark 50-tool long conversation bytes and reducer cost; keep evidence', async () => {
  const messages=Array.from({length:80},(_,i)=>({id:`m${i}`,role:i%2?'assistant':'user',text:`message ${i} `+'x'.repeat(500)}));
  const tools=Array.from({length:50},(_,i)=>({id:`t${i}`,name:'shell',status:'completed',details:{command:`command ${i}`},output:'o'.repeat(20000)}));
  const state=stateWith(messages,tools),stream=createStateStream();
  let client=applyStateEvent(null,stream.snapshot(state));
  let fullBytes=0,patchBytes=0,reducerMs=0;
  const sampleCount=120;
  for(let i=0;i<sampleCount;i++){
    state.messages.at(-1).text+='delta-'+i+';';
    const full=JSON.stringify(state);
    const event=stream.update(state);
    const frame=`data: ${JSON.stringify(event)}\n\n`;
    fullBytes+=Buffer.byteLength(full);
    patchBytes+=Buffer.byteLength(frame);
    const start=performance.now();client=applyStateEvent(client,event);reducerMs+=performance.now()-start;
  }
  assert.deepEqual(client,state);
  const intervalSeconds=0.060,samplesPerSecond=1/intervalSeconds;
  const result={scenario:{toolCalls:50,messages:80,toolOutputBytes:1000000,events:sampleCount,intervalMs:60},baseline:{meanBytesPerEvent:Math.round(fullBytes/sampleCount),estimatedBytesPerSecond:Math.round(fullBytes/sampleCount*samplesPerSecond)},incremental:{meanBytesPerEvent:Math.round(patchBytes/sampleCount),estimatedBytesPerSecond:Math.round(patchBytes/sampleCount*samplesPerSecond)},reducer:{meanApplyMs:Number((reducerMs/sampleCount).toFixed(4)),totalMs:Number(reducerMs.toFixed(2))},note:'Synthetic Node benchmark; no browser rendering time measured.'};
  const path=new URL('../.runtime/ui-parity-20260924/stream/benchmark.json',import.meta.url);
  await mkdir(new URL('.',path),{recursive:true});
  await writeFile(path,JSON.stringify(result,null,2)+'\n');
  assert.ok(patchBytes<fullBytes/100);
});
