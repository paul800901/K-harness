import {randomUUID} from 'node:crypto';
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const VIEWPORT = {width: 1024, height: 768};
/**
 * One externally supplied browser context used by the official Playwright MCP
 * server. The AI drives it in the background; the person may use the same
 * Chrome window at any time and stops the AI from the conversation. This is
 * not an OS/browser isolation boundary.
 */
export async function createBrowserLiveSession(profile, {launchContext, downloadDirectory} = {}) {
  if (typeof profile !== 'string' || !path.isAbsolute(profile))
    throw new Error('Dedicated absolute browser profile is required.');
  if (downloadDirectory !== undefined && (typeof downloadDirectory !== 'string' || !path.isAbsolute(downloadDirectory)))
    throw new Error('Dedicated absolute download directory is required.');
  const downloadsRoot = downloadDirectory ? path.resolve(downloadDirectory) : null;
  let contextPromise;
  let context = null;
  let aiCalls = 0,
    disconnected = false,
    closed = false,
    failClosedPromise = null,
    closePromise = null;
  const downloadPages = new WeakSet();
  const saveTargets = new Set();
  const installSafeSaveAs = download => {
    if (download.__kSafeSaveAsInstalled) return;
    const originalSaveAs = download.saveAs;
    if (typeof originalSaveAs !== 'function') throw new Error('Download save operation is unavailable.');
    const allowedRoot = downloadsRoot ? path.dirname(downloadsRoot) : null;
    const safeSaveAs = async destination => {
      if (!allowedRoot) throw new Error('Download saving is not enabled for this session.');
      if (typeof destination !== 'string' || !destination) throw new Error('Download destination is invalid.');
      const target = path.resolve(destination),
        relative = path.relative(allowedRoot, target);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new Error('Download destination is outside the session output directory.');
      if (saveTargets.has(target)) throw new Error('Download destination is already being saved.');
      saveTargets.add(target);
      try {
        await ensureSafeDirectory(path.dirname(target));
        await verifySafeDirectory(allowedRoot);
        try {
          await lstat(target);
          throw new Error('Download destination already exists.');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await originalSaveAs.call(download, target);
        await verifySafeDirectory(path.dirname(target));
        const fileInfo = await lstat(target);
        if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw new Error('Unsafe download destination.');
        if (process.platform === 'win32') {
          const marker = '[ZoneTransfer]\r\nZoneId=3\r\n';
          await writeFile(`${target}:Zone.Identifier`, marker, {encoding: 'utf8', flag: 'w'});
          const readback = await readFile(`${target}:Zone.Identifier`, 'utf8');
          if (readback !== marker) throw new Error('Download security marker could not be verified.');
        }
        return;
      } finally {
        saveTargets.delete(target);
      }
    };
    download.saveAs = safeSaveAs;
    if (download.saveAs !== safeSaveAs) throw new Error('Download save operation could not be secured.');
    Object.defineProperty(download, '__kSafeSaveAsInstalled', {value: true, configurable: false});
  };
  const attachPage = page => {
    if (typeof page?.on === 'function' && !downloadPages.has(page)) {
      downloadPages.add(page);
      page.on('download', download => {
        try {
          installSafeSaveAs(download);
        } catch {
          try {
            download.saveAs = async () => {
              throw new Error('Download save operation could not be secured.');
            };
          } catch {}
        }
        void saveDownload(download);
      });
    }
  };
  const getContext = async () => {
    if (disconnected || closed) throw new Error('Browser session is unavailable.');
    if (!contextPromise)
      contextPromise = Promise.resolve()
        .then(async () => {
          return launchContext(profile, VIEWPORT);
        })
        .then(async value => {
          if (closed) {
            await value.close().catch(() => {});
            throw new Error('Browser session is unavailable.');
          }
          context = value;
          value.on?.('close', () => {
            disconnected = true;
          });
          value.on?.('page', attachPage);
          for (const page of value.pages?.() ?? []) attachPage(page);
          return value;
        })
        .catch(error => {
          contextPromise = null;
          disconnected = true;
          throw error;
        });
    return contextPromise;
  };
  const safeName = value => {
    const leaf = path.basename(String(value ?? 'download').replaceAll('\\', '/'));
    let safe = leaf
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 180);
    const deviceBase = safe
      .split('.', 1)[0]
      .replace(/[. ]+$/g, '')
      .toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceBase)) safe = `_${safe}`;
    return safe && safe !== '.' && safe !== '..' ? safe : 'download';
  };
  const verifySafeDirectory = async directory => {
    const absolute = path.resolve(directory),
      parsed = path.parse(absolute);
    let cursor = parsed.root;
    for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error('Download directory contains a link or non-directory component.');
    }
    return absolute;
  };
  const ensureSafeDirectory = async directory => {
    const absolute = path.resolve(directory),
      parsed = path.parse(absolute);
    let cursor = parsed.root;
    for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      try {
        const info = await lstat(cursor);
        if (info.isSymbolicLink() || !info.isDirectory())
          throw new Error('Download directory contains a link or non-directory component.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        try {
          await mkdir(cursor);
        } catch (createError) {
          if (createError.code !== 'EEXIST') throw createError;
        }
        const info = await lstat(cursor);
        if (info.isSymbolicLink() || !info.isDirectory())
          throw new Error('Download directory contains a link or non-directory component.');
      }
    }
    return verifySafeDirectory(absolute);
  };
  // Browser downloads land in this conversation's output directory, one folder per download.
  async function saveDownload(download) {
    if (!downloadsRoot) return;
    try {
      const name = safeName(
        await Promise.resolve()
          .then(() => download.suggestedFilename?.())
          .catch(() => '')
      );
      await ensureSafeDirectory(downloadsRoot);
      const folder = path.join(downloadsRoot, randomUUID());
      await mkdir(folder);
      const folderInfo = await lstat(folder);
      if (folderInfo.isSymbolicLink() || !folderInfo.isDirectory()) throw new Error('Unsafe download destination.');
      if (!download.__kSafeSaveAsInstalled) throw new Error('Download save operation could not be secured.');
      await download.saveAs(path.join(folder, name));
    } catch {
      /* An unsafe or failed download is simply not saved. */
    }
  }
  const state = async () => ({
    recoveryRequired: closed || disconnected,
    ...(closed || disconnected ? {error: '瀏覽器連線已中止。請重新開啟對話以重新連線；先前操作不會自動重送。'} : {}),
    busy: aiCalls > 0,
    available: !!context && !disconnected && !closed
  });
  const reloadPageAtIndex = async index => {
    if (!Number.isInteger(index) || index < 0) throw new Error('Unknown or closed browser page.');
    const ctx = await getContext();
    const live = (ctx.pages?.() ?? []).filter(page => !page.isClosed?.());
    const page = live[index];
    if (!page) throw new Error('Unknown or closed browser page.');
    await page.reload();
  };
  const beginAiCall = () => {
    if (disconnected || closed) return false;
    aiCalls++;
    return true;
  };
  const endAiCall = () => {
    aiCalls = Math.max(0, aiCalls - 1);
  };
  const failClosed = () => {
    if (!failClosedPromise)
      failClosedPromise = (async () => {
        closed = true;
        if (contextPromise) await contextPromise.catch(() => {});
        if (context) await context.close();
      })();
    return failClosedPromise;
  };
  return {
    contextGetter: getContext,
    async openDataPage(url) {
      const value = await getContext();
      if (!value.openDataPage) return null;
      const page = await value.openDataPage(url);
      return value.pages().indexOf(page);
    },
    beginAiCall,
    endAiCall,
    reloadPageAtIndex,
    getState: state,
    failClosed,
    close() {
      if (!closePromise)
        closePromise = (async () => {
          await failClosed().catch(() => {});
        })();
      return closePromise;
    }
  };
}
