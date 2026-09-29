import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDesktopController} from '../src/desktop-controller.mjs';

async function fixture({failThreadStart=false}={}){
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'desktop-permission-modes-'));
 const calls=[];let hooks,close,turnNumber=0,failStart=failThreadStart;
 const catalog=[{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'high'}]},{model:'gpt-6-astra',displayName:'GPT-6 Astra',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high',inputModalities:['text','image']}];
 const host={closed:null,notify(){},waitForMcp:async()=>{},close:async()=>close?.(),request:async(method,p)=>{
  calls.push({method,p});
  if(method==='account/read')return {account:{type:'chatgpt'}};
  if(method==='model/list')return {data:catalog,nextCursor:null};
  if(method==='thread/start'&&failStart){failStart=false;throw new Error('simulated thread-start failure');}
  if(method==='thread/start'||method==='thread/resume')return {thread:{id:p.threadId??'test-thread'}};
  if(method==='thread/read')return {thread:{turns:[]}};
  if(method==='config/read')return {config:{developer_instructions:''}};
  if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
  if(method==='turn/start'){
   const id='turn-'+(++turnNumber);hooks.onEvent({method:'turn/started',params:{threadId:p.threadId,turn:{id}}});return {turn:{id}};
  }
  if(method==='turn/interrupt')hooks.onEvent({method:'turn/completed',params:{threadId:p.threadId,turn:{id:p.turnId,status:'interrupted'}}});
  return {};
 }};
 const c=createDesktopController({root,executable:'fixture',hostFactory:options=>{hooks=options;host.closed=new Promise(resolve=>{close=resolve;});return host;}});
 return {c,calls,root,host,get hooks(){return hooks;}};
}

const expectedByMode={
 'read-only':{approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'read-only',sandboxPolicy:{type:'readOnly'},sandboxWorkspaceWrite:false},
 'workspace-write':{approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'workspace-write',sandboxPolicy:{type:'workspaceWrite'},sandboxWorkspaceWrite:true},
 'auto-review':{approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:'workspace-write',sandboxPolicy:{type:'workspaceWrite'},sandboxWorkspaceWrite:true},
 'danger-full-access':{approvalPolicy:'never',approvalsReviewer:'user',sandbox:'danger-full-access',sandboxPolicy:{type:'dangerFullAccess'},sandboxWorkspaceWrite:false},
};

test('all four desktop modes keep thread start, resume, and turn permissions aligned',async t=>{
 for(const [mode,expected] of Object.entries(expectedByMode))await t.test(mode,async()=>{
  const f=await fixture();try{
   await f.c.open({model:'gpt-6-astra',accessMode:mode,...(['auto-review','danger-full-access'].includes(mode)?{permissionConfirmed:true}:{})});
   const assertThreadPermissions=thread=>{
    assert.equal(thread.approvalPolicy,expected.approvalPolicy);assert.equal(thread.approvalsReviewer,expected.approvalsReviewer);assert.equal(thread.sandbox,expected.sandbox);
    assert.equal(thread.config.approval_policy,expected.approvalPolicy);assert.equal(thread.config.approvals_reviewer,expected.approvalsReviewer);assert.equal(thread.config.sandbox_mode,expected.sandbox);
    assert.equal('sandbox_workspace_write' in thread.config,expected.sandboxWorkspaceWrite);
    if(expected.sandboxWorkspaceWrite){assert.deepEqual(thread.config.sandbox_workspace_write.writable_roots,[f.root]);assert.equal(thread.config.sandbox_workspace_write.network_access,false);}
   };
   assertThreadPermissions(f.calls.find(call=>call.method==='thread/start').p);
   await f.c.send({text:'same selected mode'});
   const assertTurnPermissions=turn=>{
    assert.equal(turn.approvalPolicy,expected.approvalPolicy);assert.equal(turn.approvalsReviewer,expected.approvalsReviewer);
    assert.deepEqual(turn.sandboxPolicy,{...expected.sandboxPolicy,...(expected.sandboxPolicy.type==='workspaceWrite'?{writableRoots:[f.root],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}:{})});
   };
   assertTurnPermissions(f.calls.findLast(call=>call.method==='turn/start').p);
   f.hooks.onEvent({method:'turn/completed',params:{threadId:'test-thread',turn:{id:'turn-1',status:'completed'}}});
   await f.c.selectWorkspace({path:f.root});await f.c.open({model:'gpt-6-astra',threadId:'test-thread'});
   assertThreadPermissions(f.calls.findLast(call=>call.method==='thread/resume').p);
   await f.c.send({text:'resumed same mode'});assertTurnPermissions(f.calls.findLast(call=>call.method==='turn/start').p);
  }finally{await f.c.close();}
 });
});

test('unconfirmed high-permission open and send leave the selected conversation unchanged',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'existing message'});await f.c.stop();
  const snapshot=()=>({threadId:f.c.state.threadId,status:f.c.state.status,accessMode:f.c.state.accessMode,messages:f.c.state.messages.map(message=>({role:message.role,text:message.text}))});
  const before=snapshot(),starts=f.calls.filter(call=>call.method==='thread/start'||call.method==='thread/resume').length,turns=f.calls.filter(call=>call.method==='turn/start').length;
  for(const mode of ['auto-review','danger-full-access'])for(const confirmation of [undefined,false]){
   await assert.rejects(f.c.open({model:'gpt-6-astra',accessMode:mode,...(confirmation===undefined?{}:{permissionConfirmed:confirmation})}),/permissionConfirmed:true/);
   assert.deepEqual(snapshot(),before);
  }
  assert.equal(f.calls.filter(call=>call.method==='thread/start'||call.method==='thread/resume').length,starts);
  for(const mode of ['auto-review','danger-full-access'])for(const confirmation of [undefined,false]){
   await assert.rejects(f.c.send({text:'must not send',accessMode:mode,...(confirmation===undefined?{}:{permissionConfirmed:confirmation})}),/permissionConfirmed:true/);
   assert.deepEqual(snapshot(),before);
  }
  assert.equal(f.calls.filter(call=>call.method==='turn/start').length,turns);
 }finally{await f.c.close();}
});

test('native fork requires confirmation only when raising permissions',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});
  f.c.state.messages=[{id:'fork-point',role:'assistant',turnId:'turn-fork',partial:false}];
  f.host.request=async(method,p)=>{
   f.calls.push({method,p});
   if(method==='account/read')return {account:{type:'chatgpt'}};
   if(method==='thread/fork')return {thread:{id:'fork-child'}};
   if(method==='thread/resume')return {thread:{id:p.threadId}};
   if(method==='thread/read')return {thread:{turns:[]}};
   if(method==='config/read')return {config:{developer_instructions:''}};
   if(method==='thread/backgroundTerminals/list')return {data:[],nextCursor:null};
   if(method==='model/list')return {data:[{model:'gpt-6-astra',supportedReasoningEfforts:[{reasoningEffort:'high'}]},{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'high'}]}],nextCursor:null};
   return {};
  };
  await assert.rejects(f.c.fork({messageId:'fork-point',accessMode:'danger-full-access'}),/permissionConfirmed:true/);
  assert.equal(f.calls.some(call=>call.method==='thread/fork'),false);
  await f.c.fork({messageId:'fork-point',accessMode:'danger-full-access',permissionConfirmed:true});
  assert.equal(f.calls.find(call=>call.method==='thread/fork').p.sandbox,'danger-full-access');
 }finally{await f.c.close();}
});

test('saved high permission restores without another confirmation and modes can return to workspace-write',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra',accessMode:'auto-review',permissionConfirmed:true});
  assert.equal((await f.c.sessions()).sessions[0].accessMode,'auto-review');
  await f.c.selectWorkspace({path:f.root});
  await f.c.open({model:'gpt-6-astra',threadId:'test-thread'});
  assert.equal(f.c.state.accessMode,'auto-review');assert.equal(f.calls.findLast(call=>call.method==='thread/resume').p.approvalsReviewer,'auto_review');
  await f.c.send({text:'lower permission',accessMode:'workspace-write'});
  assert.equal(f.c.state.accessMode,'workspace-write');assert.equal(f.calls.findLast(call=>call.method==='turn/start').p.approvalsReviewer,'user');
  assert.equal((await f.c.sessions()).sessions[0].accessMode,'workspace-write');
 }finally{await f.c.close();}
});

test('confirmed saved-session permission change takes effect without altering native worker authority',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});const before={threadId:f.c.state.threadId,status:f.c.state.status,accessMode:f.c.state.accessMode};
  for(const confirmation of [undefined,false]){
   await assert.rejects(f.c.open({model:'gpt-6-astra',threadId:'test-thread',accessMode:'danger-full-access',...(confirmation===undefined?{}:{permissionConfirmed:confirmation})}),/permissionConfirmed:true/);
   assert.deepEqual({threadId:f.c.state.threadId,status:f.c.state.status,accessMode:f.c.state.accessMode},before);
  }
  await f.c.open({model:'gpt-6-astra',threadId:'test-thread',accessMode:'danger-full-access',permissionConfirmed:true});
  const resume=f.calls.findLast(call=>call.method==='thread/resume').p;
  assert.equal(resume.approvalPolicy,'never');assert.equal(resume.sandbox,'danger-full-access');
 }finally{await f.c.close();}
});

test('a rejected danger-full-access thread start is not retried or downgraded',async()=>{
 const f=await fixture({failThreadStart:true});try{
  await assert.rejects(f.c.open({model:'gpt-6-astra',accessMode:'danger-full-access',permissionConfirmed:true}),/simulated thread-start failure/);
  const starts=f.calls.filter(call=>call.method==='thread/start');
  assert.equal(starts.length,1);assert.equal(starts[0].p.sandbox,'danger-full-access');assert.equal(starts[0].p.approvalPolicy,'never');
  assert.equal(f.calls.some(call=>call.method==='thread/resume'||call.method==='turn/start'),false);
 }finally{await f.c.close();}
});

test('auto-approval review activities retain official decisions and only show for the active owned turn',async()=>{
 const f=await fixture();try{
  await f.c.open({model:'gpt-6-astra'});await f.c.send({text:'review activity'});
  const started={reviewId:'review-1',targetItemId:'command-1',threadId:'test-thread',turnId:'turn-1',action:{type:'command',command:'node task.mjs'},review:{status:'inProgress',rationale:'Examining the requested command.',riskLevel:'low',userAuthorization:'user-requested'},startedAtMs:100};
  f.hooks.onEvent({method:'item/autoApprovalReview/started',params:started});
  let activity=f.c.state.tools.find(tool=>tool.id==='auto-approval-review:review-1');
  assert.equal(activity.name,'自動核准審查');assert.equal(activity.status,'inProgress');assert.equal(activity.details.action.command,'node task.mjs');
  f.hooks.onEvent({method:'item/autoApprovalReview/started',params:{...started,reviewId:'foreign-thread',threadId:'elsewhere'}});
  f.hooks.onEvent({method:'item/autoApprovalReview/started',params:{...started,reviewId:'stale-turn',turnId:'turn-old'}});
  assert.equal(f.c.state.tools.some(tool=>tool.id==='auto-approval-review:foreign-thread'||tool.id==='auto-approval-review:stale-turn'),false);
  const completed={...started,review:{status:'denied',rationale:'The requested command exceeds the authorized scope.',riskLevel:'high',userAuthorization:'not-authorized'},completedAtMs:125,decisionSource:'autoReview'};
  f.hooks.onEvent({method:'item/autoApprovalReview/completed',params:completed});
  activity=f.c.state.tools.find(tool=>tool.id==='auto-approval-review:review-1');
  assert.equal(activity.status,'denied');assert.equal(activity.details.review.rationale,completed.review.rationale);assert.equal(activity.details.decisionSource,'autoReview');
 }finally{await f.c.close();}
});

test('all native permission modes retain native turn sandbox on start and resume',async()=>{
 for(const [mode,type] of [['read-only','readOnly'],['workspace-write','workspaceWrite'],['auto-review','workspaceWrite'],['danger-full-access','dangerFullAccess']]){
  const f=await fixture();try{
   await f.c.open({model:'gpt-6-astra',accessMode:mode,permissionConfirmed:true});
   assert.equal(f.c.state.executionPolicy,null);
   assert.equal(f.calls.findLast(c=>c.method==='thread/start').p.sandbox,mode==='auto-review'?'workspace-write':mode);
   await f.c.send({text:'fake native turn',accessMode:mode,permissionConfirmed:true});
   assert.equal(f.calls.findLast(c=>c.method==='turn/start').p.sandboxPolicy.type,type);
   f.hooks.onEvent({method:'turn/completed',params:{threadId:'test-thread',turn:{id:'turn-1',status:'completed'}}});
   await f.c.open({model:'gpt-6-astra',threadId:'test-thread',accessMode:mode,permissionConfirmed:true});
   assert.equal(f.calls.findLast(c=>c.method==='thread/resume').p.sandbox,mode==='auto-review'?'workspace-write':mode);
   assert.equal(JSON.stringify(f.calls).includes('externalSandbox'),false);
  }finally{await f.c.close();}
 }
});
