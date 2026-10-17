export function codexQuota(result, checkedAt = new Date().toISOString()) {
  const bucket = result?.rateLimitsByLimitId ? result.rateLimitsByLimitId.codex : result?.rateLimits;
  const windows = ['primary', 'secondary'].map(key => {
    const w = bucket?.[key];
    return {
      key,
      remainingPercent: Number.isFinite(w?.usedPercent) ? Math.min(100, Math.max(0, 100 - w.usedPercent)) : null,
      minutes: Number.isFinite(w?.windowDurationMins) ? w.windowDurationMins : null,
      resetsAt: Number.isFinite(w?.resetsAt) ? w.resetsAt : null
    };
  });
  const c = bucket?.credits ?? result?.rateLimits?.credits;
  const credits =
    c && typeof c === 'object'
      ? {balance: typeof c.balance === 'string' ? c.balance : null, unlimited: c.unlimited === true}
      : null;
  const r = result?.rateLimitResetCredits;
  const resetCredits = Number.isFinite(r?.availableCount)
    ? {
        availableCount: r.availableCount,
        items: Array.isArray(r.credits)
          ? r.credits
              .filter(x => x?.status === 'available')
              .map(x => ({
                title: typeof x.title === 'string' ? x.title : null,
                expiresAt: Number.isFinite(x.expiresAt) ? x.expiresAt : null
              }))
          : null
      }
    : null;
  return {
    status: windows.some(w => w.remainingPercent !== null) ? 'available' : 'unavailable',
    windows,
    credits,
    resetCredits,
    checkedAt
  };
}
