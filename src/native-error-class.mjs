import {selfHostBridgeError, selfHostPreparationCodes} from '../shared/selfhost-error.mjs';

// Classifies a native Codex turn error for goal recovery: proven hard limits, ordinary rate limits, or other.
export function recoveryErrorClass(error) {
  if (typeof error?.message !== 'string') return 'unknown';
  // K's own self-host refusal (busy, failed/unknown load) arrives as codexErrorInfo
  // "other"; recovery would only repeat it, or replay work whose result is unknown.
  if (selfHostPreparationCodes.has(selfHostBridgeError(error)?.code)) return 'hard';
  const info = error.codexErrorInfo,
    details = error.additionalDetails,
    codes = typeof info === 'string' ? [info] : info && typeof info === 'object' ? Object.keys(info) : [];
  const statuses = info && typeof info === 'object' ? Object.values(info).map(value => value?.httpStatusCode) : [];
  const hardCodes = [
    'contextWindowExceeded',
    'sessionBudgetExceeded',
    'usageLimitExceeded',
    'quotaExceeded',
    'budgetExceeded',
    'insufficient_quota',
    'unauthorized',
    'permissionDenied',
    'sandboxError',
    'cyberPolicy',
    'misalignmentPolicyViolation',
    'tooManyDenials',
    'badRequest',
    'threadRollbackFailed',
    'activeTurnNotSteerable'
  ];
  const detailCodes = [details?.code, details?.error?.code].filter(value => typeof value === 'string');
  const text = [error.message, typeof details === 'string' ? details : details?.message, details?.error?.message]
    .filter(value => typeof value === 'string')
    .join('\n');
  // Proven native hard limits outrank HTTP429. "Retry limit" is not a usage limit.
  if (
    statuses.some(value => [401, 403].includes(value)) ||
    [...codes, ...detailCodes].some(value => hardCodes.includes(value)) ||
    /quota[ _-]+(?:exceeded|exhausted)|insufficient[ _-]+quota|(?:exceeded|reached|exhausted|hit).{0,80}(?:weekly|usage)[ _-]+(?:usage[ _-]+)?limit|(?:weekly|usage)[ _-]+(?:usage[ _-]+)?limit.{0,50}(?:exceeded|reached|exhausted)|(?:token|session)[ _-]+budget[ _-]+(?:exceeded|exhausted)|context[ _-]+window[ _-]+exceeded|permission[ _-]+denied|authentication[ _-]+failed|invalid[ _-]+credentials/i.test(
      text
    )
  )
    return 'hard';
  return statuses.includes(429) ||
    codes.includes('rateLimitExceeded') ||
    /^(?:exceeded retry limit, last status: )?429 Too Many Requests(?:[.;:].*)?$/i.test(error.message) ||
    /^rate limit (?:reached|exceeded)(?:[.:].*)?$/i.test(error.message)
    ? 'rate'
    : 'other';
}
