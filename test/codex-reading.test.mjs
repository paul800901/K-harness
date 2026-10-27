import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readTextPage, MAX_PAGE_BYTES} from '../scripts/read-text-page.mjs';
import {CODEX_READING_GUIDANCE} from '../src/codex-reading.mjs';
import {scratchBase} from './scratch.mjs';

const cli = fileURLToPath(new URL('../scripts/read-text-page.mjs', import.meta.url));
async function source(content) {
  const dir = await mkdtemp(path.join(scratchBase, 'reading-'));
  const file = path.join(dir, "原文 [單引號'] $().md");
  await writeFile(file, content);
  return file;
}

async function readAll(file) {
  let offset = 0,
    version;
  const pages = [];
  do {
    const page = await readTextPage(file, offset, version);
    assert.equal(page.startByte, offset);
    if (version) assert.equal(page.version, version);
    assert.equal(page.endByte, offset + Buffer.byteLength(page.text));
    assert.ok(Buffer.byteLength(JSON.stringify(page)) + 1 <= MAX_PAGE_BYTES);
    assert.ok(page.endByte > offset || page.totalBytes === 0);
    assert.equal(page.nextOffset, page.endByte < page.totalBytes ? page.endByte : null);
    version = page.version;
    offset = page.nextOffset;
    pages.push(page);
  } while (offset !== null);
  assert.equal(pages.at(-1).endByte, pages[0].totalBytes);
  return pages;
}

test('long Chinese Markdown is reconstructed byte for byte, including BOM, CRLF, Unicode and middle conditions', async () => {
  const text =
    '\uFEFF# 合成原文\r\n' +
    Array.from({length: 900}, (_, n) =>
      n === 451
        ? '中間必要條件：不得把「尚未確認」改成「已確認」。\r\n'
        : n + '：完整保留中文、🙂、𠀀與組合字 e\u0301。\r\n'
    ).join('') +
    '原文結尾\r\n';
  const pages = await readAll(await source(text));
  assert.ok(pages.length > 3);
  assert.deepEqual(Buffer.from(pages.map(p => p.text).join('')), Buffer.from(text));
  assert.equal(pages.filter(p => p.text.includes('中間必要條件')).length, 1);
});

test('one long JSON line and escape-heavy text obey the serialized byte limit without removing fields', async () => {
  for (const text of [
    JSON.stringify({before: '甲🙂'.repeat(5000), condition: '保留否定與順序', after: '\\"乙'.repeat(5000)}),
    '\u0001\t"\\\r\n'.repeat(5000)
  ]) {
    const pages = await readAll(await source(text));
    assert.equal(pages.map(p => p.text).join(''), text);
  }
});

test('continuations require the same source version and a valid byte boundary', async () => {
  const file = await source('🙂原文'.repeat(3000));
  const first = await readTextPage(file);
  await assert.rejects(readTextPage(file, first.nextOffset), /前頁 version/);
  await assert.rejects(readTextPage(file, 1, first.version), /UTF-8 字元中間/);
  await assert.rejects(readTextPage(file, first.totalBytes + 1, first.version), /超過檔案範圍/);
  await assert.rejects(readTextPage(file, -1), /非負整數/);
  await assert.rejects(readTextPage(file, 0, 'wrong'), /SHA-256/);
  await writeFile(file, '🙂改文'.repeat(3000));
  await assert.rejects(readTextPage(file, first.nextOffset, first.version), /來源版本已變更/);
});

test('empty input is explicit; invalid UTF-8 is rejected rather than replaced', async () => {
  const [empty] = await readAll(await source(''));
  assert.equal(empty.text, '');
  assert.equal(empty.nextOffset, null);
  await assert.rejects(readTextPage(await source(Buffer.from([0x61, 0xc0, 0xaf]))), /不是有效 UTF-8/);
});

test('the real CLI prints bounded original text and fails explicitly on incomplete reads', async () => {
  const file = await source('CLI 原文🙂\r\n'.repeat(1500));
  const run = args => spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', windowsHide: true});
  const first = run([file]);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(Buffer.byteLength(first.stdout) <= MAX_PAGE_BYTES);
  const page = JSON.parse(first.stdout);
  assert.ok(page.nextOffset > 0);
  const next = run([file, String(page.nextOffset), page.version]);
  assert.equal(next.status, 0, next.stderr);
  assert.equal(JSON.parse(next.stdout).startByte, page.endByte);
  for (const args of [[file, String(page.nextOffset)], [file, '1e3'], [file + '.missing']]) {
    const failed = run(args);
    assert.equal(failed.status, 1);
    assert.equal(typeof JSON.parse(failed.stdout).error, 'string');
    assert.equal(JSON.parse(failed.stdout).text, undefined);
  }
});

test('guidance uses the parent Node executable in Electron and safely quotes its path', () => {
  const executable = "C:\\工具 'quoted'\\node.exe";
  const module = new URL('../src/codex-reading.mjs', import.meta.url).href;
  const code =
    'import {CODEX_READING_GUIDANCE} from ' +
    JSON.stringify(module) +
    '; process.stdout.write(CODEX_READING_GUIDANCE);';
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    windowsHide: true,
    env: {...process.env, K_ISOLATED_PARENT_NODE_EXECUTABLE: executable}
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("& 'C:\\工具 ''quoted''\\node.exe'"));
  assert.ok(CODEX_READING_GUIDANCE.includes('[Console]::OutputEncoding=[Text.Encoding]::UTF8'));
});

test(
  'Windows PowerShell preserves Chinese through direct output and UTF-8 JSON capture',
  {skip: process.platform !== 'win32'},
  async () => {
    const file = await source('\uFEFF中文🙂與否定：尚未確認。\r\n'.repeat(900));
    const expected = await readTextPage(file);
    const quote = s => "'" + s.replaceAll("'", "''") + "'";
    const command = '& ' + quote(process.execPath) + ' ' + quote(cli) + ' ' + quote(file);
    for (const shell of ['powershell.exe', 'pwsh.exe']) {
      for (const capture of [false, true]) {
        const script =
          '[Console]::OutputEncoding=[Text.Encoding]::GetEncoding(950); ' +
          '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
          (capture
            ? '$readingResult = ' + command + ' | ConvertFrom-Json; $readingResult | ConvertTo-Json -Compress -Depth 5'
            : command);
        const result = spawnSync(
          shell,
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
          {encoding: 'utf8', windowsHide: true}
        );
        if (shell === 'pwsh.exe' && result.error?.code === 'ENOENT') break;
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), expected, shell + ' capture=' + capture);
      }
    }
  }
);
