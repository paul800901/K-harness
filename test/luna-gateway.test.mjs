import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createLunaGateway} from '../src/luna-gateway.mjs';

function fixture() {
  const records=new Map();let closeCount=0;
  const bridge={
    workerPolicy:{model:'auto',effort:'auto'},
    workerOptions:[{model:'gpt-6.1-sol',efforts:['low','high','ultra']},{model:'gpt-6-luna',efforts:['low','high']}],
    async start({requestId,task}) { const old=records.get(requestId);if(old){if(old.task!==task)throw Error('different task');return old;}const record={requestId,provider:'codex',model:'gpt-6-luna',status:'running',settled:false,acceptance:'not-reviewed',task,output:'',outputFiles:[]};records.set(requestId,record);return record; },
    async wait({requestId}) {const r=records.get(requestId);if(r){r.status='completed';r.settled=true;r.output='done';}return r??null;},
    async inspect({requestId}) {return records.get(requestId)??null;},
    async cancel({requestId}) {const r=records.get(requestId);if(r){r.status='cancelled';r.settled=true;}return r??null;},
    async close(){closeCount++;},
  };
  return {bridge,records,closeCount:()=>closeCount};
}
async function post(url,token,message,headers={}) {
  return fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body:JSON.stringify(message)});
}
function spoofHost(url,token){
  const target=new URL(url);
  return new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port:Number(target.port),path:target.pathname,method:'POST',headers:{host:'attacker.invalid',authorization:`Bearer ${token}`,'content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.end('{}');
  });
}
async function body(response){const text=await response.text();const data=text.split(/\r?\n/u).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');return JSON.parse(data||text);}

test('gateway is loopback-only, bearer-authenticated, and exposes fixed MCP Luna tools',async()=>{
  const f=fixture();const gateway=await createLunaGateway({bridge:f.bridge});
  try {
    const config=gateway.mcpConfig.mcpServers.k_luna;
    assert.equal(config.type,'http');assert.match(config.url,/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    assert.match(config.headers.Authorization,/^Bearer [A-Za-z0-9_-]{40,}$/);
    const token=config.headers.Authorization.slice(7);
    assert.equal((await post(config.url,'wrong',{jsonrpc:'2.0',id:1,method:'initialize',params:{}})).status,401);
    const init=await body(await post(config.url,token,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}}));
    assert.equal(init.result.serverInfo.name,'k-luna-gateway');
    const listed=await body(await post(config.url,token,{jsonrpc:'2.0',id:2,method:'tools/list',params:{}}));
    assert.deepEqual(listed.result.tools.map(tool=>tool.name).sort(),['luna_cancel','luna_inspect','luna_start','luna_wait']);
    assert.match(listed.result.tools.find(tool=>tool.name==='luna_start').description,/AI 自動選擇目前啟用/);
    assert.match(listed.result.tools.find(tool=>tool.name==='luna_start').description,/gpt-6\.1-sol: low, high, ultra/);
    const started=await body(await post(config.url,token,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'luna_start',arguments:{requestId:'stable',task:'bounded'}}}));
    assert.equal(started.result.structuredContent.model,'gpt-6-luna');
    const duplicate=await body(await post(config.url,token,{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'luna_start',arguments:{requestId:'stable',task:'bounded'}}}));
    assert.equal(duplicate.result.structuredContent.requestId,'stable');assert.equal(f.records.size,1);
    const changed=await body(await post(config.url,token,{jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'luna_start',arguments:{requestId:'stable',task:'different'}}}));
    assert.equal(changed.result.isError,true);
    assert.match(changed.result.content[0].text,/different task/);
    assert.equal((await post(config.url,token,{jsonrpc:'2.0',id:6,method:'tools/list',params:{}},{origin:'https://evil.example'})).status,403);
    assert.equal(await spoofHost(config.url,token),403);
    assert.equal((await fetch(config.url.replace('/mcp','/else'),{method:'POST',headers:{authorization:`Bearer ${token}`}})).status,404);
  } finally {await gateway.close();}
  assert.equal(f.closeCount(),1);
});

test('gateway wait, inspect and cancel route only stable request ids to the bridge',async()=>{
  const f=fixture();const gateway=await createLunaGateway({bridge:f.bridge});
  try {
    const config=gateway.mcpConfig.mcpServers.k_luna,token=config.headers.Authorization.slice(7);
    await post(config.url,token,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}});
    const call=async(id,name,args)=>body(await post(config.url,token,{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}}));
    await call(2,'luna_start',{requestId:'r1',task:'t'});
    assert.equal((await call(3,'luna_wait',{requestId:'r1',timeoutMs:0})).result.structuredContent.status,'completed');
    assert.equal((await call(4,'luna_inspect',{requestId:'r1'})).result.structuredContent.output,'done');
    assert.equal((await call(5,'luna_cancel',{requestId:'r1'})).result.structuredContent.status,'cancelled');
  } finally {await gateway.close();}
});

test('gateway acknowledges only successfully prepared results, not output preparation errors',async()=>{
 const f=fixture(),acks=[];f.bridge.resultReady=(args,value)=>acks.push([args.requestId,value.settled]);
 const gateway=await createLunaGateway({bridge:f.bridge});
 try{
  const config=gateway.mcpConfig.mcpServers.k_luna,token=config.headers.Authorization.slice(7);
  const call=async(id,name,args)=>body(await post(config.url,token,{jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}}));
  await call(1,'luna_start',{requestId:'r',task:'bounded'});assert.deepEqual(acks,[['r',false]]);
  Object.assign(f.records.get('r'),{settled:true,status:'completed',output:'x'.repeat(5000),workspace:'invalid',parentId:'parent'});
  const bad=await call(2,'luna_inspect',{requestId:'r'});assert.equal(bad.result.isError,true);assert.equal(acks.length,1);
  f.records.get('r').output='done';await call(3,'luna_inspect',{requestId:'r'});assert.deepEqual(acks,[['r',false],['r',true]]);
 }finally{await gateway.close();}
});

test('MCP start forwards both worker choices and an explicit effort to the bridge',async()=>{
 const f=fixture();const calls=[];f.bridge.start=async args=>{calls.push(args);return {requestId:args.requestId,model:args.model,effort:args.effort,status:'running'};};
 const gateway=await createLunaGateway({bridge:f.bridge});
 try{
  const config=gateway.mcpConfig.mcpServers.k_luna,token=config.headers.Authorization.slice(7);
  await post(config.url,token,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'workers',version:'1'}}});
  const listed=await body(await post(config.url,token,{jsonrpc:'2.0',id:2,method:'tools/list'}));
  assert.deepEqual(listed.result.tools.find(t=>t.name==='luna_start').inputSchema.properties.model.enum,['gpt-6.1-sol','gpt-6-luna']);
  let id=3;for(const model of ['gpt-6.1-sol','gpt-6-luna']){
   const args={requestId:model,task:'fake task',model,effort:'low'};
   const result=await body(await post(config.url,token,{jsonrpc:'2.0',id:id++,method:'tools/call',params:{name:'luna_start',arguments:args}}));
   assert.notEqual(result.result.isError,true);assert.deepEqual(calls.at(-1),args);assert.equal(result.result.structuredContent.model,model);assert.equal(result.result.structuredContent.effort,'low');
  }
 }finally{await gateway.close();}
});

test('MCP tool description reflects a concrete user default without implying AI-auto',async()=>{
 const f=fixture();f.bridge.workerPolicy={model:'gpt-6.1-sol',effort:'ultra'};f.bridge.workerOptions=[];
 const gateway=await createLunaGateway({bridge:f.bridge});
 try{
  const config=gateway.mcpConfig.mcpServers.k_luna,token=config.headers.Authorization.slice(7);
  await post(config.url,token,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'policy',version:'1'}}});
  const listed=await body(await post(config.url,token,{jsonrpc:'2.0',id:2,method:'tools/list'}));
  const description=listed.result.tools.find(tool=>tool.name==='luna_start').description;
  assert.match(description,/目前預設為 gpt-6\.1-sol \/ ultra/);assert.doesNotMatch(description,/AI 自動選擇目前啟用/);
 }finally{await gateway.close();}
});
