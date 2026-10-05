const hiddenEngineeringKinds=new Set(['status','deprecationNotice','configWarning','windowsWorldWritableWarning','windowsSandboxReadiness','windowsSandboxSetupCompleted']);

export function visibleNativeNotices(notices=[],displayedError=null) {
 const visible=notices.filter(notice=>!hiddenEngineeringKinds.has(notice.kind)&&!(notice.kind==='worker-completion'&&notice.level==='info')&&!(notice.kind==='nativeError'&&notice.message===displayedError)&&!(notice.willRetry&&notice.resolved)&&!(notice.kind==='warning'&&/^Falling back from WebSockets to HTTPS transport\b/.test(notice.message)));
 // Keep raw records intact. Only the latest update of each retry episode is shown.
 return visible.filter((notice,index)=>!notice.willRetry||!visible.slice(index+1).some(next=>next.willRetry&&next.retryKey===notice.retryKey&&next.turnId===notice.turnId));
}

export function nativeNoticeText(notice) {
 const raw=String(notice.message??'');
 if(notice.willRetry){
  const attempt=/^Reconnecting(?:\.{3}|…)\s*(\d+\/\d+)\s*$/.exec(raw);
  return attempt?`正在重新連線（${attempt[1]}）`:/^Reconnecting(?:\.{3}|…)\s*waiting for network\s*$/.test(raw)?'等待網路恢復…':'原生核心正在重試…';
 }
 return raw.length>160?raw.slice(0,160)+'…':raw;
}

// Presentation only: native records stay unchanged; unknown wording stays intact.
export function localizeNativeNotice(message,provider) {
 if(provider!=='claude'||typeof message!=='string')return message;
 const match=/^You've hit your session limit(?: · resets (1[0-2]|[1-9])(?::([0-5]\d))?(am|pm) \(([^()\r\n]+)\))?$/.exec(message);
 if(!match)return message;
 if(!match[1])return '本時段額度已用完。';
 const hour=String(Number(match[1])%12+(match[3]==='pm'?12:0)).padStart(2,'0');
 const zone=match[4]==='Asia/Taipei'?'臺灣時間':match[4];
 return `本時段額度已用完；${hour}:${match[2]??'00'}（${zone}）恢復。`;
}
