/** Project only the small, observable portion of Claude's native rate-limit event. */
export function claudeRateStatus(previous = {}, event = {}) {
  const info = event?.rate_limit_info;
  if (typeof info?.status !== 'string' || !info.status) return { ...previous, changed: false, notice: null };

  const status = info.status;
  const changed = previous.status !== status;
  const extraUsageDisabled = status === 'allowed'
    && info.overageStatus === 'rejected'
    && (info.overageDisabledReason === 'org_level_disabled' || info.overageDisableReason === 'org_level_disabled');
  const notice = status !== 'allowed' && changed
    ? { status, level: 'warning', kind: 'rate-limit', message: `Claude 額度狀態：${status}。請查看官方額度面板。` }
    : null;
  return {
    status,
    extraUsageDisabled: extraUsageDisabled ? true : (status === 'allowed' ? false : null),
    changed,
    notice,
  };
}
