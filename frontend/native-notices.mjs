const hiddenEngineeringKinds=new Set(['status','deprecationNotice','configWarning','windowsWorldWritableWarning','windowsSandboxReadiness','windowsSandboxSetupCompleted']);

export function visibleNativeNotices(notices=[],displayedError=null) {
 const visible=notices.filter(notice=>!hiddenEngineeringKinds.has(notice.kind)&&!(notice.kind==='worker-completion'&&notice.level==='info')&&!(notice.kind==='nativeError'&&notice.message===displayedError)&&!(notice.willRetry&&notice.resolved)&&!(notice.kind==='warning'&&notice.message==="Codex couldn't save diagnostic logs to its local database. Use /feedback with logs included before closing Codex, or run `codex doctor` for diagnostics.")&&!(notice.kind==='warning'&&/^Falling back from WebSockets to HTTPS transport\b/.test(notice.message)));
 // Keep raw records intact. Only the latest update of each retry episode is shown.
 return visible.filter((notice,index)=>!notice.willRetry||!visible.slice(index+1).some(next=>next.willRetry&&next.retryKey===notice.retryKey&&next.turnId===notice.turnId));
}

export function nativeNoticeText(notice,provider='codex') {
 const raw=String(notice.message??'');
 if(notice.willRetry){
  const attempt=/^Reconnecting(?:\.{3}|…)\s*(\d+\/\d+)\s*$/.exec(raw);
  return attempt?`正在重新連線（${attempt[1]}）`:/^Reconnecting(?:\.{3}|…)\s*waiting for network\s*$/.test(raw)?'等待網路恢復…':'原生核心正在重試…';
 }
 const localized=localizeNativeNotice(raw,provider,notice.error);
 return localized.length>160?localized.slice(0,160)+'…':localized;
}

// Presentation only, never permission to retry or change models.
export function codexErrorKind(error) {
 const info=error?.codexErrorInfo;
 if(info==='serverOverloaded')return 'capacity';
 if(info==='usageLimitExceeded')return 'quota';
 // Older records may have only this exact native message. Structured codes
 // take precedence; an arbitrary mention of capacity is not sufficient.
 if(info==null&&/^Selected model is at capacity\.(?: Please try a different model\.)?$/.test(error?.message??''))return 'capacity';
 return null;
}

// Presentation only: native records stay unchanged; unknown wording stays intact.
export function localizeNativeNotice(message,provider,error) {
 if(provider==='codex'&&typeof message==='string'){
  const kind=codexErrorKind(error?.message===message?error:{message});
  if(kind==='capacity')return '模型服務容量不足，與剩餘額度不同。請稍後再試，或自行選擇其他模型。';
  if(kind==='quota')return 'Codex 原生回報用量限制，與模型服務容量不足不同；恢復時間以官方額度資訊為準。';
 }
 if(provider!=='claude'||typeof message!=='string')return message;
 const match=/^You've hit your session limit(?: · resets (1[0-2]|[1-9])(?::([0-5]\d))?(am|pm) \(([^()\r\n]+)\))?$/.exec(message);
 if(!match)return message;
 if(!match[1])return '本時段額度已用完。';
 const hour=String(Number(match[1])%12+(match[3]==='pm'?12:0)).padStart(2,'0');
 const zone=match[4]==='Asia/Taipei'?'臺灣時間':match[4];
 return `本時段額度已用完；${hour}:${match[2]??'00'}（${zone}）恢復。`;
}
