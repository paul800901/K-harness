import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// agy 1.4.3 truncates any single rule file over 24,000 bytes; Windows checkouts use CRLF.
test('AGENTS.md stays under the agy per-file rule limit, counted with CRLF line endings', async () => {
  const text = (await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8')).replace(/\r?\n/gu, '\r\n');
  assert.ok(Buffer.byteLength(text) < 24000, `AGENTS.md is ${Buffer.byteLength(text)} bytes; move detail into docs`);
});
