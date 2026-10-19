import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryErrorClass} from '../src/native-error-class.mjs';

test('proven hard limits outrank HTTP 429', () => {
  assert.equal(recoveryErrorClass({message: 'x', codexErrorInfo: 'usageLimitExceeded'}), 'hard');
  assert.equal(
    recoveryErrorClass({message: 'x', codexErrorInfo: {responseTooManyFailedAttempts: {httpStatusCode: 403}}}),
    'hard'
  );
  assert.equal(
    recoveryErrorClass({
      message: "You've hit your weekly usage limit",
      codexErrorInfo: {responseTooManyFailedAttempts: {httpStatusCode: 429}}
    }),
    'hard'
  );
  assert.equal(recoveryErrorClass({message: 'x', additionalDetails: {error: {code: 'insufficient_quota'}}}), 'hard');
});

test('ordinary rate limits are recoverable rate errors, not quota exhaustion', () => {
  assert.equal(recoveryErrorClass({message: 'x', codexErrorInfo: 'rateLimitExceeded'}), 'rate');
  assert.equal(
    recoveryErrorClass({message: 'x', codexErrorInfo: {responseTooManyFailedAttempts: {httpStatusCode: 429}}}),
    'rate'
  );
  assert.equal(recoveryErrorClass({message: 'exceeded retry limit, last status: 429 Too Many Requests'}), 'rate');
  assert.equal(recoveryErrorClass({message: 'Rate limit reached.'}), 'rate');
});

test('K self-host preparation refusals never wake goal recovery, even as native "other"', () => {
  // Exact record observed from installed Codex 0.163.0 with a loopback HTTP 400
  // (mock native endpoint; no model load or inference): one call, no retry.
  const observed = {
    message:
      '{"error":{"message":"本機模型載入失敗；未送出推論。","code":"k_selfhost_load_failed","diagnostic":{"stderr":"Synthetic native load error; no model engine invoked."}}}',
    codexErrorInfo: 'other',
    additionalDetails: null
  };
  assert.equal(recoveryErrorClass(observed), 'hard');
  for (const code of ['k_selfhost_prepare_failed', 'k_selfhost_state_unknown', 'k_selfhost_busy']) {
    const message = JSON.stringify({error: {message: '本機模型準備未完成；未送出推論。', code}});
    assert.equal(recoveryErrorClass({message, codexErrorInfo: 'other', additionalDetails: null}), 'hard');
    assert.equal(
      recoveryErrorClass({message: 'x', codexErrorInfo: 'other', additionalDetails: JSON.parse(message)}),
      'hard'
    );
  }
  // Only K's exact coded body counts; other 400-like or look-alike text keeps its class.
  for (const message of [
    JSON.stringify({error: {message: '自架模型協定轉換或連線失敗；未改用其他模型。', code: 'k_selfhost_upstream_failed'}}),
    JSON.stringify({error: {message: 'x', code: 'invalid_request_error'}}),
    'unexpected status 400 Bad Request: k_selfhost_load_failed',
    'Bad Request'
  ])
    assert.equal(recoveryErrorClass({message, codexErrorInfo: 'other'}), 'other');
  assert.equal(
    recoveryErrorClass({message: observed.message, codexErrorInfo: {responseTooManyFailedAttempts: {httpStatusCode: 429}}}),
    'hard'
  );
});

test('other failures and malformed errors stay distinct', () => {
  assert.equal(recoveryErrorClass({message: 'stream disconnected', codexErrorInfo: 'other'}), 'other');
  assert.equal(recoveryErrorClass({codexErrorInfo: 'rateLimitExceeded'}), 'unknown');
  assert.equal(recoveryErrorClass(null), 'unknown');
});
