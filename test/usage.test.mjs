import test from 'node:test';
import assert from 'node:assert/strict';
import {codexQuota} from '../src/usage.mjs';
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
  assert.deepEqual(detailed.credits, {balance: '61861', unlimited: false});
  assert.deepEqual(detailed.resetCredits, {availableCount: 1, items: [{title: '完整重置', expiresAt: 1793918940}]});
  assert.equal(codexQuota({rateLimits: {}, rateLimitResetCredits: {availableCount: 1}}).resetCredits.items, null);
});
