import test from 'node:test';
import assert from 'node:assert/strict';
import {createCodexLogin} from '../src/codex-login.mjs';
function fixture(account=null,url='https://auth.openai.com/oauth/authorize?state=test'){
 const calls=[];let event,closes=0;
 const service=createCodexLogin({hostFactory:options=>{event=options.onEvent;return {closed:new Promise(()=>{}),notify(){},async close(){closes++;},async request(method,params){calls.push({method,params});if(method==='account/read')return {account};if(method==='account/login/start')return {type:'chatgpt',loginId:'test-id',authUrl:url};return {};}};}});
 return {service,calls,get closes(){return closes;},complete(success){event({method:'account/login/completed',params:{loginId:'test-id',success,error:'SECRET'}});},setAccount(value){account=value;}};
}
test('Codex status is read-only and redacts account identity',async()=>{
 const f=fixture({type:'chatgpt',planType:'pro',email:'PRIVATE',token:'SECRET'});
 const status=await f.service.status();assert.equal(status.available,true);assert.equal(status.auth.planType,'pro');assert.equal(f.closes,1);assert.ok(!JSON.stringify(status).match(/PRIVATE|SECRET/));
 await f.service.start();assert.ok(!f.calls.some(c=>c.method==='account/login/start'));await f.service.close();
});
test('explicit Codex login uses ChatGPT only, single flight, completion and cancel',async()=>{
 const f=fixture();assert.equal((await f.service.status()).available,false);
 await Promise.all([f.service.start(),f.service.start()]);assert.deepEqual(f.calls.filter(c=>c.method==='account/login/start'),[{method:'account/login/start',params:{type:'chatgpt'}}]);
 f.complete(true);f.setAccount({type:'chatgpt',planType:'plus'});assert.equal((await f.service.status()).login.status,'complete');
 f.setAccount(null);await f.service.start();await f.service.cancel();assert.ok(f.calls.some(c=>c.method==='account/login/cancel'&&c.params.loginId==='test-id'));
 assert.ok(!f.calls.some(c=>/thread\/|turn\/|logout/.test(c.method)));await f.service.close();
});
test('API identity is not subscription and invalid authorization URL is not exposed',async()=>{
 const f=fixture({type:'apiKey'},'https://evil.example/oauth?SECRET');assert.equal((await f.service.status()).available,false);
 const result=await f.service.start();assert.equal(result.login.status,'error');assert.equal(result.login.url,undefined);await f.service.close();
});
