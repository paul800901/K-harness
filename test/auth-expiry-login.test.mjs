import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {startDesktop} from '../src/desktop-server.mjs';
import {reportAuthExpired, clearAuthExpired} from '../src/auth-expiry.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 20));

test('a main-room login expiry starts the official sign-in once and opens only the official Codex URL', async () => {
  const claudeStarts = [],
    codexStarts = [],
    opened = [];
  let codexUrl = 'https://auth.openai.com/oauth/authorize?state=first';
  const app = await startDesktop({
    root: path.resolve('.'),
    port: 0,
    requireLaunchToken: true,
    controllerFactory: () => ({state: {}, async close() {}}),
    claudeLoginFactory: () => ({
      start: async () => {
        claudeStarts.push(1);
        return {login: {status: 'running'}};
      },
      async close() {}
    }),
    codexLoginFactory: () => ({
      start: async () => {
        codexStarts.push(1);
        return {login: {status: 'running', url: codexUrl}};
      },
      async close() {}
    }),
    openExternalUrl: async url => opened.push(url)
  });
  try {
    reportAuthExpired('claude');
    await tick();
    assert.equal(claudeStarts.length, 1);
    assert.deepEqual(opened, [], 'the Claude CLI opens its own sign-in page');

    reportAuthExpired('codex');
    await tick();
    reportAuthExpired('codex');
    await tick();
    assert.equal(codexStarts.length, 2);
    assert.deepEqual(
      opened,
      ['https://auth.openai.com/oauth/authorize?state=first'],
      'a waiting sign-in is not reopened'
    );

    codexUrl = 'https://evil.example/oauth/authorize?state=x';
    reportAuthExpired('codex');
    await tick();
    assert.equal(opened.length, 1, 'only an official URL is opened');

    reportAuthExpired('gemini');
    await tick();
    assert.equal(claudeStarts.length + codexStarts.length, 4, 'other providers are ignored');
  } finally {
    await app.close();
    clearAuthExpired('claude');
    clearAuthExpired('codex');
    clearAuthExpired('gemini');
  }
  reportAuthExpired('claude');
  await tick();
  assert.equal(claudeStarts.length, 1, 'a closed desktop no longer reacts');
  clearAuthExpired('claude');
});
