import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {threadPermissions, turnPermissions} from '../src/desktop-permissions.mjs';

// Source checks complement the built-UI observation in test/selfhost-ui-probe.mjs.
const picker = await readFile(new URL('../frontend/permission-picker.jsx', import.meta.url), 'utf8');
const dialogs = await readFile(new URL('../frontend/dialogs.jsx', import.meta.url), 'utf8');

test('permission copy is honest: no external isolation promise; self-host auto-review marked unverified', () => {
  // The native host deployment has no K isolation layer for any Codex-core provider.
  assert.doesNotMatch(picker, /外部隔離/);
  const selfHost = picker.slice(
    picker.indexOf('export const selfHostPermissionModes'),
    picker.indexOf('export const claudePermissionModes')
  );
  assert.match(selfHost, /\.\.\.permissionModes,/);
  assert.match(selfHost, /'auto-review'[\s\S]*尚未驗證/);
  // Never claim the self-hosted model, GPT or K reviews, or that review was accepted.
  assert.doesNotMatch(selfHost, /Dolphin|GPT|已驗證|已驗收/);
  // The confirmation paragraph (inside <p>), not the <strong> title with the same ternary shape.
  const confirmParagraph = picker.slice(
    picker.indexOf('<p>', picker.indexOf('className="permission-confirm"')),
    picker.indexOf('</p>', picker.indexOf('className="permission-confirm"'))
  );
  const [, fullAccess, selfHostAutoReview] = confirmParagraph.match(
    /pending === 'danger-full-access'\s*\?\s*'([^']*)'\s*:\s*provider === 'gemma'\s*\?\s*'([^']*)'/
  );
  assert.match(fullAccess, /^此對話將略過 Codex 權限提示與命令沙箱/);
  assert.match(fullAccess, /K 沒有另外的隔離層/);
  assert.match(selfHostAutoReview, /尚未驗證/);
  assert.match(selfHostAutoReview, /K 不會替你改成其他權限模式/);
  assert.doesNotMatch(selfHostAutoReview, /Dolphin|GPT|已驗證/);
  // The self-host provider selects its own copy in the picker and the fork dialog.
  assert.match(picker, /provider === 'gemma'\s*\? selfHostPermissionModes/);
  assert.match(dialogs, /targetProvider === 'gemma'\s*\? selfHostPermissionModes/);
});

test('copy changes leave the native permission settings sent to the Codex core unchanged', () => {
  assert.equal(turnPermissions('auto-review', 'C:/w').approvalsReviewer, 'auto_review');
  assert.equal(turnPermissions('auto-review', 'C:/w').approvalPolicy, 'on-request');
  assert.equal(threadPermissions('auto-review', 'C:/w').config.approvals_reviewer, 'auto_review');
  assert.deepEqual(turnPermissions('danger-full-access', 'C:/w').sandboxPolicy, {type: 'dangerFullAccess'});
  assert.equal(turnPermissions('danger-full-access', 'C:/w').approvalPolicy, 'never');
  assert.equal(turnPermissions('workspace-write', 'C:/w').approvalsReviewer, 'user');
});
