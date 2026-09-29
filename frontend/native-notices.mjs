export function visibleNativeNotices(notices=[]) {
 return notices.filter(notice=>notice.kind!=='status'&&notice.kind!=='externalSandboxNetwork');
}
