import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleNativeNotices} from '../frontend/native-notices.mjs';
import * as nativeNotices from '../frontend/native-notices.mjs';

test('retry projection keeps the latest incident update, terminal errors, and raw records',()=>{
 const notices=[
  {id:'a',kind:'nativeError',level:'error',turnId:'t',willRetry:true,retryKey:'incident',message:'Reconnecting... 1/5'},
  {id:'b',kind:'nativeError',level:'error',turnId:'t',willRetry:true,retryKey:'incident',message:'Reconnecting... 2/5'},
  {id:'old',kind:'nativeError',willRetry:true,resolved:true,retryKey:'old',message:'resolved'},
  {id:'fatal',kind:'nativeError',willRetry:false,message:'Native request failed'},
  {id:'transport',kind:'warning',message:'Falling back from WebSockets to HTTPS transport. stream disconnected before completion'},
  {id:'different',kind:'guardianWarning',message:'WebSockets permission denied'},
 ];
 const before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices).map(n=>n.id),['b','fatal','different']);
 assert.deepEqual(notices,before);
 assert.equal(nativeNotices.nativeNoticeText(notices[1]),'正在重新連線（2/5）');
 assert.equal(nativeNotices.nativeNoticeText({...notices[1],message:'Reconnecting... waiting for network'}),'等待網路恢復…');
 assert.equal(nativeNotices.nativeNoticeText({...notices[1],message:'Unknown retry reason'}),'原生核心正在重試…');
 const long={message:'原生錯誤'.repeat(100)};
 assert.equal(nativeNotices.nativeNoticeText(long),long.message.slice(0,160)+'…');
 assert.equal(long.message.length,400);
});

test('hides engineering notices without mutating the native records',()=>{
 const notices=['status','deprecationNotice','configWarning','windowsWorldWritableWarning','windowsSandboxReadiness','windowsSandboxSetupCompleted']
  .map((kind,index)=>({id:`hidden-${index}`,kind,level:'warning',message:`${kind} detail`}));
 const before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices),[]);
 assert.deepEqual(notices,before);
});

test('routine worker handoff is not a user notice; failures and original records remain',()=>{
 const notices=[
  {id:'handoff',kind:'worker-completion',level:'info',message:'Flash 子代理結果已交給 Codex 主代理驗收。'},
  {id:'failure',kind:'worker-completion',level:'error',message:'交付結果失敗'},
 ];
 const before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices),[notices[1]]);
 assert.deepEqual(notices,before);
});

test('retains unknown warnings, guardian warnings, model routing, and native errors',()=>{
 const notices=[
  {id:'warning',kind:'warning',level:'warning'},
  {id:'guardian',kind:'guardianWarning',level:'warning'},
  {id:'reroute',kind:'modelRerouted',level:'warning'},
  {id:'error',kind:'nativeError',level:'error'},
 ];
 const before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices),notices);
 assert.deepEqual(notices,before);
});

test('a native Codex error already shown in the main alert is not shown again',()=>{
 const message='Native quota limit reached';
 const notices=[{id:'quota',kind:'nativeError',message},{id:'other',kind:'nativeError',message:'Different error'},{id:'warning',kind:'warning',message:'Important warning'}];
 assert.deepEqual(visibleNativeNotices(notices,message).map(n=>n.id),['other','warning']);
 assert.deepEqual(visibleNativeNotices(notices).map(n=>n.id),['quota','other','warning']);
});

test('Claude native quota text is localized without changing its reset time or timezone',()=>{
 const text=nativeNotices.localizeNativeNotice;
 assert.equal(text("You've hit your session limit · resets 5:30pm (Asia/Taipei)",'claude'),'本時段額度已用完；17:30（臺灣時間）恢復。');
 assert.equal(text("You've hit your session limit · resets 12am (Asia/Taipei)",'claude'),'本時段額度已用完；00:00（臺灣時間）恢復。');
 assert.equal(text("You've hit your session limit · resets 12pm (America/New_York)",'claude'),'本時段額度已用完；12:00（America/New_York）恢復。');
 assert.equal(text("You've hit your session limit",'claude'),'本時段額度已用完。');
});

test('unknown native notices and other providers retain their complete original details',()=>{
 for(const message of ['Unknown failure: request abc123',"You've hit your session limit · resets Oct 1, 2026 at 5pm (Asia/Taipei)",'已經是正體中文',null])assert.equal(nativeNotices.localizeNativeNotice(message,'claude'),message);
 const message="You've hit your session limit · resets 5:30pm (Asia/Taipei)";
 assert.equal(nativeNotices.localizeNativeNotice(message,'codex'),message);
});


test('diagnostic SQLite warning stays in raw records, not the everyday notice banner',()=>{
 const record={id:'logs',kind:'warning',message:"Codex couldn't save diagnostic logs to its local database. Use /feedback with logs included before closing Codex, or run `codex doctor` for diagnostics."};
 const failure={id:'task',kind:'warning',message:'Could not save conversation history'};
 const notices=[record,failure],before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices),[failure]);
 assert.deepEqual(notices,before);
});


test('Codex capacity and quota are distinct; conflicting codes and unknown errors stay literal',()=>{
 const raw='Selected model is at capacity. Please try a different model.';
 assert.equal(nativeNotices.codexErrorKind({message:raw}),'capacity');
 assert.equal(nativeNotices.codexErrorKind({message:'other wording',codexErrorInfo:'serverOverloaded'}),'capacity');
 assert.equal(nativeNotices.codexErrorKind({message:raw,codexErrorInfo:'usageLimitExceeded'}),'quota');
 assert.equal(nativeNotices.codexErrorKind({message:raw,codexErrorInfo:'other'}),null);
 assert.equal(nativeNotices.codexErrorKind({message:'Tool capacity failed'}),null);
 assert.match(nativeNotices.localizeNativeNotice(raw,'codex'),/與剩餘額度不同/);
 assert.match(nativeNotices.localizeNativeNotice('native quota','codex',{message:'native quota',codexErrorInfo:'usageLimitExceeded'}),/用量限制/);
 const error={message:raw,codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:null}}};
 assert.match(nativeNotices.localizeNativeNotice(raw,'codex',error),/回覆在完成前中斷/);
 assert.equal(nativeNotices.nativeNoticeText({message:raw,error,willRetry:true}),'原生核心正在重試…');
 assert.equal(nativeNotices.localizeNativeNotice(raw,'gemini'),raw);
 assert.equal(nativeNotices.localizeNativeNotice(raw,'claude'),raw);
});

test('Codex 429 retry exhaustion is not displayed as proven quota exhaustion',()=>{
 const message='exceeded retry limit, last status: 429 Too Many Requests';
 const error={message,codexErrorInfo:{responseTooManyFailedAttempts:{httpStatusCode:429}},additionalDetails:null},before=structuredClone(error);
 for(const value of [error,{message},{message,codexErrorInfo:'other'},{message:'native throttle',codexErrorInfo:'rateLimitExceeded'}]){
  assert.equal(nativeNotices.codexErrorKind(value),'rate');
  const text=nativeNotices.localizeNativeNotice(value.message,'codex',value);
  assert.match(text,/請求.*限制/);assert.match(text,/不能.*額度耗盡/);assert.doesNotMatch(text,/\d+\s*(?:秒|分鐘|小時)|自動重送|一定|保證/);
 }
 assert.deepEqual(error,before);
 assert.equal(nativeNotices.codexErrorKind({...error,codexErrorInfo:'usageLimitExceeded'}),'quota');
 assert.equal(nativeNotices.codexErrorKind({...error,codexErrorInfo:'unauthorized'}),null);
 assert.equal(nativeNotices.codexErrorKind({message:'Tool said '+message}),null);
 assert.equal(nativeNotices.codexErrorKind({...error,codexErrorInfo:{responseTooManyFailedAttempts:{httpStatusCode:503}}}),null);
 for(const provider of ['claude','gemini'])assert.equal(nativeNotices.localizeNativeNotice(message,provider,error),message);
 assert.equal(nativeNotices.localizeNativeNotice('unrelated displayed error','codex',error),'unrelated displayed error');
});

test('native stream failures are localized without guessing a cause or changing raw diagnostics',()=>{
 const message='stream disconnected before completion: An error occurred while processing your request. Please include the request ID fake-request-id in your message.';
 const error={message,codexErrorInfo:'other',additionalDetails:null},before=structuredClone(error);
 const expected='Codex 回覆在完成前中斷；本輪未完成。接續前先核對已保存成果，K 不會自動重送。';
 assert.equal(nativeNotices.localizeNativeNotice(message,'codex',error),expected);
 assert.equal(nativeNotices.localizeNativeNotice(message,'codex'),expected);
 assert.equal(nativeNotices.localizeNativeNotice('different wording','codex',{message:'different wording',codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:null}}}),expected);
 assert.deepEqual(error,before);
 assert.equal(nativeNotices.nativeNoticeText({message,error,willRetry:true}),'原生核心正在重試…');
 for(const provider of ['claude','gemini'])assert.equal(nativeNotices.localizeNativeNotice(message,provider,error),message);
 for(const text of ['Tool said '+message,'stream disconnected before completion','Unknown error'])assert.equal(nativeNotices.localizeNativeNotice(text,'codex',{message:text,codexErrorInfo:'other'}),text);
 for(const code of ['unauthorized','internalServerError',{httpConnectionFailed:{httpStatusCode:500}}])assert.equal(nativeNotices.localizeNativeNotice(message,'codex',{message,codexErrorInfo:code}),message);
 assert.match(nativeNotices.localizeNativeNotice(message,'codex',{message,codexErrorInfo:'serverOverloaded'}),/容量不足/);
 assert.match(nativeNotices.localizeNativeNotice(message,'codex',{message,codexErrorInfo:'usageLimitExceeded'}),/用量限制/);
 assert.equal(nativeNotices.localizeNativeNotice('unrelated displayed error','codex',error),'unrelated displayed error');
});

test('the exact native remote compaction stream wrapper keeps its phase and raw diagnostics',()=>{
 const message='Error running remote compact task: stream disconnected before completion: An error occurred while processing your request. Please include the request ID fake-compact-request-id in your message.';
 const error={message,codexErrorInfo:'other',additionalDetails:null},before=structuredClone(error);
 const expected='Codex 原生壓縮在完成前中斷；本輪未完成。接續前先核對已保存成果，K 不會自動重送。';
 assert.equal(nativeNotices.codexErrorKind(error),'stream');
 assert.equal(nativeNotices.localizeNativeNotice(message,'codex',error),expected);
 assert.equal(nativeNotices.localizeNativeNotice(message,'codex'),expected);
 assert.equal(nativeNotices.localizeNativeNotice(message,'codex',{...error,codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:null}}}),expected);
 assert.equal(nativeNotices.nativeNoticeText({message,error,willRetry:true}),'原生核心正在重試…');
 assert.deepEqual(error,before);
 for(const provider of ['claude','gemini'])assert.equal(nativeNotices.localizeNativeNotice(message,provider,error),message);
 for(const text of ['Tool said '+message,'Error running remote compact task: Unknown failure','Error running remote compact task: stream disconnected before completion',message.toLowerCase()])assert.equal(nativeNotices.localizeNativeNotice(text,'codex',{...error,message:text}),text);
 for(const code of ['unauthorized','internalServerError',{httpConnectionFailed:{httpStatusCode:500}}])assert.equal(nativeNotices.localizeNativeNotice(message,'codex',{...error,codexErrorInfo:code}),message);
 assert.match(nativeNotices.localizeNativeNotice(message,'codex',{...error,codexErrorInfo:'serverOverloaded'}),/容量不足/);
 assert.match(nativeNotices.localizeNativeNotice(message,'codex',{...error,codexErrorInfo:'usageLimitExceeded'}),/用量限制/);
 assert.equal(nativeNotices.localizeNativeNotice('unrelated displayed error','codex',error),'unrelated displayed error');
});

test('only precisely resolved native terminal attention is hidden and all raw notices remain intact',()=>{
 const terminal={threadId:'child',turnId:'child-turn',status:'completed'},message='同文未確認';
 const notices=[{id:'resolved',kind:'worker-attention',message,nativeTerminal:terminal,resolved:true},{id:'unknown',kind:'worker-attention',message,nativeTerminal:{...terminal,threadId:'another'}},{id:'other',kind:'worker-attention',message,resolved:true},{id:'other-kind',kind:'warning',message,nativeTerminal:terminal,resolved:true}];
 const before=structuredClone(notices);assert.deepEqual(nativeNotices.visibleNativeNotices(notices).map(n=>n.id),['unknown','other','other-kind']);assert.deepEqual(notices,before);
});

test('resolved recovery and Gemini handoff notices leave the banner while real failures and raw records remain',()=>{
 const active=[
  {id:'recovery',kind:'goal-recovery',level:'info',turnId:'failed-turn',message:'核對已存成果，確認後接續剩餘工作。'},
  {id:'handoff',kind:'gemini-handoff',level:'info',message:'Gemini 正等待現有工人自然結束，再查核帳號額度；未重播原工單。'},
 ];
 assert.deepEqual(visibleNativeNotices(active),active,'live lifecycle notices remain visible');
 const notices=[
  ...active.map(n=>({...n,resolved:true})),
  {id:'recovery-failed',kind:'goal-recovery',level:'warning',message:'成果核對回合已失敗；未自動重送。'},
  {id:'recovery-unknown',kind:'goal-recovery',level:'warning',resolved:false,message:'成果核對通知未確認；未自動重送。'},
  {id:'handoff-failed',kind:'gemini-handoff',level:'warning',message:'Gemini 帳號交接未完成：官方額度或停止狀態未確認。'},
  {id:'native-failed',kind:'nativeError',level:'error',resolved:true,message:'原生主工作失敗'},
  {id:'other-warning',kind:'warning',level:'warning',resolved:true,message:'其他真正警告'},
 ];
 const before=structuredClone(notices);
 assert.deepEqual(visibleNativeNotices(notices).map(n=>n.id),['recovery-failed','recovery-unknown','handoff-failed','native-failed','other-warning']);
 assert.deepEqual(notices,before,'hiding a lifecycle banner must not erase or rewrite diagnostics');
});
