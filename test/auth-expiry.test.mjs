import test from 'node:test';
import assert from 'node:assert/strict';
import {authExpired, reportAuthExpired, clearAuthExpired, onAuthExpired} from '../src/auth-expiry.mjs';
import {codexAuthExpired} from '../shared/codex-auth-error.mjs';

test('Codex auth expiry is recognized from structured codes or the exact native refresh wording only', () => {
  for (const error of [
    {message: 'x', codexErrorInfo: 'unauthorized'},
    {message: 'x', codexErrorInfo: {httpConnectionFailed: {httpStatusCode: 401}}},
    {message: 'x', codexErrorInfo: {responseStreamConnectionFailed: {httpStatusCode: 401}}},
    {
      message:
        'Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.',
      codexErrorInfo: 'other'
    }
  ])
    assert.equal(codexAuthExpired(error), true, JSON.stringify(error));
  for (const error of [
    {message: 'x', codexErrorInfo: 'usageLimitExceeded'},
    {message: 'x', codexErrorInfo: {responseTooManyFailedAttempts: {httpStatusCode: 429}}},
    {message: 'model mentioned an access token could not be refreshed', codexErrorInfo: 'other'},
    null
  ])
    assert.equal(codexAuthExpired(error), false, JSON.stringify(error));
});

test('login expiry reports reach listeners until unsubscribed and stay marked until cleared', () => {
  const seen = [];
  const stop = onAuthExpired(provider => seen.push(provider));
  onAuthExpired(() => {
    throw Error('a failing listener does not block others');
  });
  try {
    reportAuthExpired('codex');
    assert.deepEqual(seen, ['codex']);
    assert.equal(authExpired('codex'), true);
    stop();
    reportAuthExpired('claude');
    assert.deepEqual(seen, ['codex']);
  } finally {
    clearAuthExpired('codex');
    clearAuthExpired('claude');
  }
  assert.equal(authExpired('codex'), false);
});
