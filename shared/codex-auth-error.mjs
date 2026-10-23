// A Codex turn error proving the subscription login can no longer authenticate.
// Structured native code first; the exact native refresh wording is the fallback.
export function codexAuthExpired(error) {
  const info = error?.codexErrorInfo;
  if (info === 'unauthorized') return true;
  if (info && typeof info === 'object' && Object.values(info).some(value => value?.httpStatusCode === 401)) return true;
  return /^Your access token could not be refreshed\b/.test(error?.message ?? '');
}
