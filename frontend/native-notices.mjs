const hiddenEngineeringKinds=new Set(['status','deprecationNotice','configWarning','windowsWorldWritableWarning','windowsSandboxReadiness','windowsSandboxSetupCompleted']);

export function visibleNativeNotices(notices=[],displayedError=null) {
 return notices.filter(notice=>!hiddenEngineeringKinds.has(notice.kind)&&!(notice.kind==='worker-completion'&&notice.level==='info')&&!(notice.kind==='nativeError'&&notice.message===displayedError));
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
