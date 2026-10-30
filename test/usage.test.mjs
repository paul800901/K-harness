import test from 'node:test';
import assert from 'node:assert/strict';
import {codexQuota, codexExecutionBlockedUntil} from '../src/usage.mjs';
test('Codex quota prefers core multi-bucket, clamps remaining and never guesses unknown as zero', () => {
  const result = codexQuota(
    {
      rateLimits: {primary: {usedPercent: 1}},
      rateLimitsByLimitId: {
        codex: {primary: {usedPercent: 34, windowDurationMins: 300, resetsAt: 123}, secondary: null},
        other: {primary: {usedPercent: 90}}
      }
    },
    'fixed'
  );
  assert.equal(result.windows[0].remainingPercent, 66);
  assert.equal(result.windows[1].remainingPercent, null);
  assert.equal(result.checkedAt, 'fixed');
  assert.equal(
    codexQuota({rateLimits: {primary: {usedPercent: 120}, secondary: {usedPercent: -1}}}).windows[0].remainingPercent,
    0
  );
  assert.equal(
    codexQuota({rateLimitsByLimitId: {other: {primary: {usedPercent: 2}}}, rateLimits: {primary: {usedPercent: 4}}})
      .status,
    'unavailable'
  );
  assert.equal(codexQuota({}).status, 'unavailable');
  assert.equal(codexQuota({}).credits, null);
  assert.equal(codexQuota({}).resetCredits, null);
});
test('Codex quota keeps official credit balance and reset-credit count; detail rows only when the backend returns them', () => {
  const detailed = codexQuota({
    rateLimits: {primary: {usedPercent: 0}, credits: {hasCredits: true, unlimited: false, balance: '61861'}},
    rateLimitResetCredits: {
      availableCount: 1,
      credits: [
        {
          id: 'x',
          grantedAt: 1,
          resetType: 'codexRateLimits',
          status: 'available',
          title: '完整重置',
          expiresAt: 1793918940
        },
        {id: 'y', grantedAt: 1, resetType: 'codexRateLimits', status: 'redeemed'}
      ]
    }
  });
  assert.deepEqual(detailed.credits, {balance: '61861', unlimited: false, hasCredits: true});
  assert.deepEqual(detailed.resetCredits, {availableCount: 1, items: [{title: '完整重置', expiresAt: 1793918940}]});
  assert.equal(codexQuota({rateLimits: {}, rateLimitResetCredits: {availableCount: 1}}).resetCredits.items, null);
});

test('execution uses native credit availability, never a guessed balance or reset credit', () => {
  const now = Date.now(),
    resetsAt = Math.floor(now / 1000) + 3600;
  for (const [credits, blocked] of [
    [{hasCredits: true, balance: '123', unlimited: false}, false],
    [{hasCredits: false, unlimited: true}, false],
    [{hasCredits: false, balance: '123'}, true],
    [{balance: '123'}, true],
    [null, true]
  ]) {
    const quota = codexQuota({
      rateLimits: {secondary: {usedPercent: 100, resetsAt}, credits},
      rateLimitResetCredits: {availableCount: 1}
    });
    assert.equal(codexExecutionBlockedUntil(quota, now), blocked ? resetsAt * 1000 : null);
    assert.equal(quota.windows[1].remainingPercent, 0);
  }
});
