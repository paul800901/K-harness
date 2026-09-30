/** Project only the small, observable portion of Claude's native rate-limit event. */
export function claudeRateStatus(previous = {}, event = {}) {
  const info = event?.rate_limit_info;
  if (typeof info?.status !== 'string' || !info.status) return previous;

  const status = info.status;
  const extraUsageDisabled = status === 'allowed'
    && info.overageStatus === 'rejected'
    && (info.overageDisabledReason === 'org_level_disabled' || info.overageDisableReason === 'org_level_disabled');
  return {
    status,
    extraUsageDisabled: extraUsageDisabled ? true : (status === 'allowed' ? false : null),
  };
}
