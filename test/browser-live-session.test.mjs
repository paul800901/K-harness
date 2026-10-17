import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createBrowserLiveSession} from '../src/browser-live-session.mjs';

function fakeContext() {
  const listeners = {};
  const context = {
    pages: () => context._pages.filter(page => !page.closed),
    _pages: [],
    on: (name, fn) => (listeners[name] = fn),
    emit: (name, ...args) => listeners[name]?.(...args),
    async newPage() {
      const page = fakePage();
      context._pages.push(page);
      listeners.page?.(page);
      return page;
    },
    async close() {
      listeners.close?.();
    }
  };
  return context;
}
function fakePage() {
  const navigations = [];
  const listeners = {};
  const page = {
    closed: false,
    isClosed: () => page.closed,
    reload: async () => navigations.push('reload'),
    navigations,
    close: async () => {
      page.closed = true;
    },
    on: (name, fn) => (listeners[name] = fn),
    emit: (name, ...args) => listeners[name]?.(...args)
  };
  return page;
}
async function savedFiles(directory) {
  const files = [];
  for (const folder of await readdir(directory).catch(() => []))
    for (const name of await readdir(path.join(directory, folder))) files.push({folder, name});
  return files;
}
async function until(read, predicate) {
  for (let n = 0; n < 100; n++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Expected browser state was not reached.');
}

test('externally owned contexts do not probe browser processes or prepare local download history', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'k-external-no-probe-'));
  const original = childProcess.execFile;
  let calls = 0;
  childProcess.execFile = (...args) => {
    calls++;
    args.at(-1)(Error('External browsers must not require a process scan'));
  };
  syncBuiltinESMExports();
  // An external wrapper is not a Chrome profile; this must never be opened as SQLite.
  await writeFile(path.join(profile, 'History'), 'not a browser profile');
  const context = fakeContext();
  context._pages.push(fakePage());
  let session;
  try {
    session = await createBrowserLiveSession(profile, {launchContext: async () => context});
    assert.equal(await session.contextGetter(), context);
    assert.equal(calls, 0);
    assert.equal(await readFile(path.join(profile, 'History'), 'utf8'), 'not a browser profile');
  } finally {
    await session?.close();
    childProcess.execFile = original;
    syncBuiltinESMExports();
  }
});

test('the MCP reload capability uses Playwright reload on the indexed existing page', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'k-live-browser-reload-'));
  const context = fakeContext();
  context._pages.push(fakePage(), fakePage());
  const session = await createBrowserLiveSession(profile, {launchContext: async () => context});
  try {
    await session.contextGetter();
    await session.reloadPageAtIndex(1);
    assert.deepEqual(
      context.pages().map(page => page.navigations),
      [[], ['reload']]
    );
    assert.equal(context.pages().length, 2, 'reload does not create a tab');
    await assert.rejects(session.reloadPageAtIndex(2), /Unknown or closed browser page/u);
  } finally {
    await session.close();
  }
});

test('native download events are saved under UUID directories inside the session output only', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'k-live-browser-download-'));
  const downloadDirectory = path.join(profile, 'output', 'downloads');
  const upstreamTarget = path.join(path.dirname(downloadDirectory), 'probe.txt');
  const context = fakeContext();
  context._pages.push(fakePage());
  const session = await createBrowserLiveSession(profile, {launchContext: async () => context, downloadDirectory});
  try {
    await session.contextGetter();
    const nativeDownload = {
      suggestedFilename: () => 'C:\\temp\\report.txt',
      saveAs: async target => {
        const fs = await import('node:fs/promises');
        await fs.writeFile(target, target === upstreamTarget ? 'MCP copy' : 'download body');
      }
    };
    context.pages()[0].emit('download', nativeDownload);
    await nativeDownload.saveAs(upstreamTarget);
    assert.equal(await readFile(upstreamTarget, 'utf8'), 'MCP copy');
    await assert.rejects(nativeDownload.saveAs(upstreamTarget), /already exists/);
    await assert.rejects(
      nativeDownload.saveAs(path.join(profile, 'outside', 'probe.txt')),
      /outside the session output directory/
    );
    if (process.platform === 'win32')
      assert.equal(await readFile(`${upstreamTarget}:Zone.Identifier`, 'utf8'), '[ZoneTransfer]\r\nZoneId=3\r\n');
    const [saved] = await until(
      () => savedFiles(downloadDirectory),
      files => files.length === 1
    );
    assert.match(saved.folder, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    assert.equal(saved.name, 'report.txt');
    const target = path.join(downloadDirectory, saved.folder, saved.name);
    assert.equal(await readFile(target, 'utf8'), 'download body');
    if (process.platform === 'win32')
      assert.equal(await readFile(`${target}:Zone.Identifier`, 'utf8'), '[ZoneTransfer]\r\nZoneId=3\r\n');

    context.pages()[0].emit('download', {
      suggestedFilename: () => 'cOn .txt',
      saveAs: async destination => import('node:fs/promises').then(fs => fs.writeFile(destination, 'x'))
    });
    const files = await until(
      () => savedFiles(downloadDirectory),
      list => list.length === 2
    );
    assert(files.some(file => file.name === '_cOn .txt'), 'reserved device names are prefixed');
  } finally {
    await session.close();
  }
});

test('a failed download does not close the browser or block later AI work', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'k-live-download-failure-'));
  const context = fakeContext();
  context._pages.push(fakePage());
  let closed = false;
  const originalClose = context.close;
  context.close = async () => {
    closed = true;
    await originalClose();
  };
  const session = await createBrowserLiveSession(profile, {
    launchContext: async () => context,
    downloadDirectory: path.join(profile, 'output', 'downloads')
  });
  try {
    await session.contextGetter();
    context.pages()[0].emit('download', {
      suggestedFilename: () => 'fake.exe',
      saveAs: async () => {
        throw new Error('download cancelled');
      }
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    const state = await session.getState();
    assert.equal(state.available, true);
    assert.equal(state.busy, false);
    assert.equal(state.recoveryRequired, false);
    assert.equal(closed, false);
    assert.equal(session.beginAiCall(), true);
    session.endAiCall();
    assert.equal(closed, false);
  } finally {
    await session.close();
  }
});

test('unexpected browser close fails closed for AI work and reports recovery', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'k-live-browser-close-'));
  const context = fakeContext();
  const session = await createBrowserLiveSession(profile, {launchContext: async () => context});
  try {
    await session.contextGetter();
    await context.close();
    assert.equal(session.beginAiCall(), false);
    const state = await session.getState();
    assert.equal(state.available, false);
    assert.equal(state.recoveryRequired, true);
  } finally {
    await session.close();
  }
});

test('fail-closed makes the session unavailable at once and releases busy only after browser close', async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'k-live-browser-cancel-'));
  let finishClose;
  const closeGate = new Promise(resolve => (finishClose = resolve));
  const context = fakeContext();
  context.close = async () => {
    await closeGate;
  };
  const session = await createBrowserLiveSession(profile, {launchContext: async () => context});
  try {
    await session.contextGetter();
    assert.equal(session.beginAiCall(), true);
    const failing = session.failClosed();
    assert.equal(session.beginAiCall(), false, 'unavailable must take effect before browser shutdown completes');
    let state = await session.getState();
    assert.equal(state.available, false);
    assert.equal(state.busy, true);
    finishClose();
    await failing;
    session.endAiCall();
    state = await session.getState();
    assert.equal(state.available, false);
    assert.equal(state.busy, false);
    assert.match(state.error, /下次使用瀏覽器時會重新連線/);
    assert.equal(state.recoveryRequired, true);
  } finally {
    finishClose();
    await session.close();
  }
});
