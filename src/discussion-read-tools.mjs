import path from 'node:path';
import {realpath, lstat, readdir, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const protectedPart = p =>
  /^(?:\.git|\.local|\.runtime|\.codex|\.claude|\.gemini|agent-home|\.ssh|\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|.*\.(?:pem|key|pfx|p12))$/iu.test(
    p
  );
const parameters = properties => ({type: 'object', properties, additionalProperties: false});
const relative = {type: 'string', description: '相對於本次工作區的路徑；不接受絕對路徑或上層路徑。'};
export const discussionReadTools = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出本次工作區檔案，可遞迴；不含憑證與內部執行資料。',
      parameters: parameters({path: relative, recursive: {type: 'boolean'}})
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在本次工作區的 UTF-8 文字檔中搜尋字面文字，回傳檔案、行號、原文。',
      parameters: {...parameters({path: relative, query: {type: 'string'}}), required: ['query']}
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '讀取原始 UTF-8 文字，或擷取 PDF/DOCX 文字。可指定行範圍；不含 OCR、圖片或版面。',
      parameters: {
        ...parameters({
          path: relative,
          startLine: {type: 'integer', minimum: 1},
          endLine: {type: 'integer', minimum: 1}
        }),
        required: ['path']
      }
    }
  }
];
export async function createDiscussionReader(workspace, {signal} = {}) {
  const root = await realpath(workspace),
    check = () => signal?.throwIfAborted();
  const locate = async (value = '.') => {
    check();
    if (
      typeof value !== 'string' ||
      !value ||
      /[\x00-\x1f:]/u.test(value) ||
      path.win32.isAbsolute(value) ||
      path.posix.isAbsolute(value)
    )
      throw Error('只可讀本次工作區的相對路徑。');
    const parts = value === '.' ? [] : value.split(/[\\/]/u);
    if (
      parts.some(
        p =>
          !p ||
          p === '.' ||
          p === '..' ||
          /[. ]$/u.test(p) ||
          /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(p) ||
          protectedPart(p)
      )
    )
      throw Error('路徑超出本次討論唯讀範圍。');
    let target = root;
    for (const part of parts) {
      target = path.join(target, part);
      if ((await lstat(target)).isSymbolicLink()) throw Error('討論不讀取連結或接合點。');
    }
    const canonical = await realpath(target),
      rel = path.relative(root, canonical);
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(protectedPart))
      throw Error('路徑超出本次工作區或含受保護資料。');
    return canonical;
  };
  const walk = async (target, recursive) => {
    check();
    const entries = [];
    for (const e of await readdir(target, {withFileTypes: true})) {
      check();
      if (protectedPart(e.name) || e.isSymbolicLink()) continue;
      const full = await locate(path.relative(root, path.join(target, e.name)));
      if (e.isDirectory()) {
        entries.push({path: path.relative(root, full).replaceAll('\\', '/'), type: 'directory'});
        if (recursive) entries.push(...(await walk(full, true)));
      } else if (e.isFile()) entries.push({path: path.relative(root, full).replaceAll('\\', '/'), type: 'file'});
    }
    return entries;
  };
  const text = async target => {
    check();
    if (!(await lstat(target)).isFile()) throw Error('請指定一般檔案。');
    const bytes = await readFile(target);
    check();
    if (path.extname(target).toLowerCase() === '.docx') {
      const {default: mammoth} = await import('mammoth');
      return {text: (await mammoth.extractRawText({buffer: bytes})).value, note: '僅 DOCX 文字，不含圖片或版面。'};
    }
    if (path.extname(target).toLowerCase() === '.pdf') {
      const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({
        data: new Uint8Array(bytes),
        standardFontDataUrl: fileURLToPath(
          new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
        ).replaceAll('\\', '/'),
        isEvalSupported: false,
        disableFontFace: true
      });
      try {
        const doc = await task.promise,
          pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
          check();
          pages.push(
            `[第 ${i} 頁]\n` + (await (await doc.getPage(i)).getTextContent()).items.map(x => x.str ?? '').join(' ')
          );
        }
        return {text: pages.join('\n\n'), note: '僅 PDF 可擷取文字，不含 OCR、圖片或版面。'};
      } finally {
        await task.destroy();
      }
    }
    if (bytes.includes(0)) throw Error('非 UTF-8 文字檔；未宣稱已讀取。');
    try {
      return {text: new TextDecoder('utf-8', {fatal: true}).decode(bytes)};
    } catch {
      throw Error('非 UTF-8 文字檔；未宣稱已讀取。');
    }
  };
  return async (name, args) => {
    check();
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('唯讀工具參數無效。');
    if (name === 'list_files') return {entries: await walk(await locate(args.path), args.recursive === true)};
    if (name === 'search_files') {
      if (typeof args.query !== 'string' || !args.query) throw Error('請指定搜尋文字。');
      const target = await locate(args.path),
        files = (await lstat(target)).isFile()
          ? [{path: path.relative(root, target), type: 'file'}]
          : await walk(target, true),
        matches = [],
        skipped = [];
      for (const f of files.filter(f => f.type === 'file')) {
        check();
        let content;
        try {
          content = new TextDecoder('utf-8', {fatal: true}).decode(await readFile(await locate(f.path)));
          if (content.includes('\0')) throw Error();
        } catch {
          skipped.push(f.path);
          continue;
        }
        content.split(/\r?\n/u).forEach((line, i) => {
          if (line.includes(args.query)) matches.push({path: f.path, line: i + 1, text: line});
        });
      }
      return {matches, skipped};
    }
    if (name === 'read_file') {
      const result = await text(await locate(args.path));
      check();
      const lines = result.text.split(/\r?\n/u),
        start = args.startLine ?? 1,
        end = args.endLine ?? lines.length;
      if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(end) || end < start)
        throw Error('讀取行範圍無效。');
      return {
        ...result,
        text: lines.slice(start - 1, end).join('\n'),
        startLine: start,
        endLine: Math.min(end, lines.length),
        totalLines: lines.length
      };
    }
    throw Error('API 討論只提供列檔、搜尋與讀檔；未執行其他工具。');
  };
}
