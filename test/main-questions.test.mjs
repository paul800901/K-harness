import test from 'node:test';
import assert from 'node:assert/strict';
import {answerMainQuestion} from '../src/main-questions.mjs';
const request={method:'item/tool/requestUserInput',params:{threadId:'k-thread',questions:[{id:'approve',question:'Run scoped worker?',options:[{label:'Accept',description:'One call'},{label:'Decline',description:'No action'}]}]}};
const context=raw=>({threadId:'k-thread',ask:async()=>raw,show:()=>{}});
test('actual MCP approval form requires YES and never persists approval',async()=>{
 const form={method:'mcpServer/elicitation/request',params:{threadId:'k-thread',mode:'form',message:'Allow scoped call?',_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{requestId:'test'}},requestedSchema:{properties:{}}}};
 assert.deepEqual(await answerMainQuestion(form,context('YES')),{action:'accept',content:{}});
 for(const answer of ['','yes','1','no'])assert.deepEqual(await answerMainQuestion(form,context(answer)),{action:'decline',content:null});
 form.params.mode='url';assert.equal(await answerMainQuestion(form,context('YES')),undefined);
});
test('K approval requires explicit selection; blank and malformed answers never accept',async()=>{
 for(const raw of ['','0','3','1anything'])assert.deepEqual(await answerMainQuestion(request,context(raw)),{answers:{approve:{answers:[]}}});
 assert.deepEqual(await answerMainQuestion(request,context('2')),{answers:{approve:{answers:['Decline']}}});
 assert.deepEqual(await answerMainQuestion(request,context('1')),{answers:{approve:{answers:['Accept']}}});
});
test('K rejects another conversation, secret questions and unsupported permission requests',async()=>{
 assert.equal(await answerMainQuestion(request,{...context('1'),threadId:'other'}),undefined);
 assert.equal(await answerMainQuestion({...request,method:'item/permissions/requestApproval'},context('1')),undefined);
 const secret=structuredClone(request);secret.params.questions[0].isSecret=true;
 assert.equal(await answerMainQuestion(secret,context('1')),undefined);
});
