import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Bound the serialized result, including JSON escaping, rather than its line count.
// This runs inside the caller's native shell permissions; it is not an MCP file-access bypass.
export const MAX_PAGE_BYTES = 6000;
const decode = bytes => new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes);
const continuation = byte => (byte & 0xc0) === 0x80;

export async function readTextPage(file, offset = 0, version) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw Error('offset 必須是非負整數。');
  if (version !== undefined && !/^[a-f0-9]{64}$/.test(version)) throw Error('version 必須是前頁回傳的 SHA-256。');
  if (offset > 0 && version === undefined) throw Error('接續讀取必須提供前頁 version，不能混用不同版本。');
  const handle = await open(file, 'r');
  let bytes;
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw Error('請指定一般 UTF-8 文字檔。');
    bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw Error('讀取期間檔案已變更；本段未交付，請核對來源。');
  } finally {
    await handle.close();
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (version !== undefined && hash !== version) throw Error('來源版本已變更；本段未交付，不能接到舊版本。');
  if (offset > bytes.length || (offset < bytes.length && continuation(bytes[offset])))
    throw Error('offset 超過檔案範圍或位於 UTF-8 字元中間。');
  try {
    decode(bytes);
  } catch {
    throw Error('來源不是有效 UTF-8；未以替代字元交付失真文字。');
  }
  let end = Math.min(bytes.length, offset + MAX_PAGE_BYTES);
  while (end < bytes.length && continuation(bytes[end])) end--;
  const chars = Array.from(decode(bytes.subarray(offset, end)));
  const page = count => {
    const text = chars.slice(0, count).join('');
    const endByte = offset + Buffer.byteLength(text);
    return {
      version: hash,
      totalBytes: bytes.length,
      startByte: offset,
      endByte,
      nextOffset: endByte < bytes.length ? endByte : null,
      text
    };
  };
  let low = 0,
    high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(page(middle))) + 1 <= MAX_PAGE_BYTES) low = middle;
    else high = middle - 1;
  }
  return page(low);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [file, offset = '0', version, ...extra] = process.argv.slice(2);
    if (!file || extra.length || !/^(0|[1-9][0-9]*)$/.test(offset))
      throw Error('用法：node read-text-page.mjs <原檔路徑> [offset=0] [前頁 version]');
    process.stdout.write(JSON.stringify(await readTextPage(file, Number(offset), version)) + '\n');
  } catch (error) {
    const message = error.code ? '讀取失敗（' + error.code + '）；本段未交付。' : error.message;
    process.stdout.write(JSON.stringify({error: message}) + '\n');
    process.exitCode = 1;
  }
}
