import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {createBrowserOwnerGateway} from '../src/browser-owner-gateway.mjs';

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'k-owner-browser-'));
  const directory = path.join(root, 'output'),
    profile = path.join(root, 'private-profile');
  await mkdir(directory);
  await mkdir(profile);
  const gateway = await createBrowserOwnerGateway({
    directory,
    profile,
    launchContext: async (profile, viewport) =>
      chromium.launchPersistentContext(profile, {channel: 'msedge', headless: true, viewport}),
    ...options
  });
  const send = (message, signal) => gateway.request(message, signal);
  const call = (id, name, args = {}) =>
    send({jsonrpc: '2.0', id, method: 'tools/call', params: {name, arguments: args}}).then(body);
  const init = () =>
    send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'owner-pilot', version: '1'}}
    }).then(body);
  return {root, directory, profile, gateway, send, call, init};
}
async function body(response) {
  assert.equal(response.status, 200);
  const text = await response.text();
  const data = text
    .split(/\r?\n/u)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean)
    .join('\n');
  return JSON.parse(data || text);
}
async function waitFor(read, predicate) {
  for (let n = 0; n < 200; n++) {
    const state = await read();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Browser did not reach expected state.');
}

test('owner gateway is an in-process MCP endpoint with no listener, token or human control surface', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(Object.keys(f.gateway).sort(), ['close', 'getState', 'request']);
    await f.init();
    const tools = await body(await f.send({jsonrpc: '2.0', id: 2, method: 'tools/list'}));
    assert(tools.result.tools.some(tool => tool.name === 'browser_navigate'));
    assert(!tools.result.tools.some(tool => tool.name === 'browser_run_code_unsafe'));
    assert.doesNotMatch(JSON.stringify(tools), /right-side browser view|Human takeover|K panel tabs/u);
    await assert.rejects(readFile(path.join(f.profile, 'live.json')), error => error.code === 'ENOENT');
    const fake = path.join(f.root, 'fake-cookie.txt');
    await writeFile(fake, 'FAKE_COOKIE_ONLY');
    assert.match(JSON.stringify(await f.call(3, 'browser_file_upload', {paths: [fake]})), /File access denied/);
    assert.match(JSON.stringify(await f.call(30, 'browser_drop', {paths: [fake]})), /File access denied/);
    assert.match(JSON.stringify(await f.call(4, 'browser_run_code_unsafe', {code: 'return 1'})), /not enabled/);
    assert.equal((await f.gateway.getState()).busy, false);
  } finally {
    await f.gateway.close();
  }
});

test('aborting a running tool call closes the browser session and reports recovery', async () => {
  const f = await fixture();
  try {
    await f.init();
    assert.notEqual((await f.call(1, 'browser_snapshot')).result.isError, true);
    const abort = new AbortController();
    const response = await f.send(
      {jsonrpc: '2.0', id: 5, method: 'tools/call', params: {name: 'browser_wait_for', arguments: {time: 30}}},
      abort.signal
    );
    const pending = response.text();
    pending.catch(() => {});
    await waitFor(f.gateway.getState, state => state.busy);
    abort.abort();
    const final = await waitFor(f.gateway.getState, state => state.recoveryRequired && !state.busy);
    assert.equal(final.available, false);
    assert.match(JSON.stringify(await f.call(6, 'browser_snapshot')), /unavailable/);
  } finally {
    await f.gateway.close();
  }
});

test('an abort after the response ended is not a cancellation', async () => {
  const f = await fixture();
  try {
    await f.init();
    const abort = new AbortController();
    const done = await body(
      await f.send(
        {jsonrpc: '2.0', id: 7, method: 'tools/call', params: {name: 'browser_snapshot', arguments: {}}},
        abort.signal
      )
    );
    assert.notEqual(done.result.isError, true);
    abort.abort();
    await new Promise(resolve => setTimeout(resolve, 50));
    const state = await f.gateway.getState();
    assert.equal(state.recoveryRequired, false);
    assert.notEqual((await f.call(8, 'browser_snapshot')).result.isError, true);
  } finally {
    await f.gateway.close();
  }
});

test('owner gateway rejects storing human profile within AI browser files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'k-owner-overlap-'));
  const profile = path.join(root, 'profile');
  await mkdir(profile);
  await assert.rejects(createBrowserOwnerGateway({directory: root, profile}), /outside AI browser files/);
});

test('Edge MCP resize, CSS zoom and AI tab selection work on the real browser', async () => {
  const site = createServer((req, res) => {
    const page =
      req.url === '/two'
        ? '<title>PAGE_TWO</title><h1>PAGE_TWO</h1>'
        : '<title>PAGE_ONE</title><h1>PAGE_ONE</h1><input id="target" aria-label="fake input" style="position:absolute;left:420px;top:260px;width:240px;height:52px">';
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${page}`);
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  let edgeContext;
  const f = await fixture({
    launchContext: async (profile, viewport) => {
      edgeContext = await chromium.launchPersistentContext(profile, {channel: 'msedge', headless: true, viewport});
      return edgeContext;
    }
  });
  let id = 10;
  const tool = async (name, args = {}) => f.call(id++, name, args);
  try {
    await f.init();
    const origin = `http://127.0.0.1:${site.address().port}`;
    assert.notEqual((await tool('browser_navigate', {url: `${origin}/one`})).result.isError, true);
    assert.notEqual((await tool('browser_tabs', {action: 'new', url: `${origin}/two`})).result.isError, true);
    assert.notEqual((await tool('browser_tabs', {action: 'list'})).result.isError, true);
    assert.equal(edgeContext.pages().length, 2);
    assert.notEqual((await tool('browser_tabs', {action: 'select', index: 0})).result.isError, true);
    assert.match(
      await edgeContext.pages()[0].evaluate(() => navigator.userAgent),
      /Edg\//,
      'the persistent context is a real Microsoft Edge session'
    );

    // The native MCP call changes the real Edge viewport, not just a UI model.
    const resized = await tool('browser_resize', {width: 1440, height: 900});
    assert.notEqual(resized.result.isError, true, JSON.stringify(resized));
    assert.deepEqual(edgeContext.pages()[0].viewportSize(), {width: 1440, height: 900});
    const zoomed = await tool('browser_evaluate', {
      function: '() => { document.documentElement.style.zoom="0.8"; return document.documentElement.style.zoom; }'
    });
    assert.notEqual(zoomed.result.isError, true, JSON.stringify(zoomed));
    assert.equal(await edgeContext.pages()[0].evaluate(() => document.documentElement.style.zoom), '0.8');
    const zoomReset = await tool('browser_evaluate', {
      function: '() => { document.documentElement.style.zoom="1"; return document.documentElement.style.zoom; }'
    });
    assert.notEqual(zoomReset.result.isError, true, JSON.stringify(zoomReset));
    assert.equal(await edgeContext.pages()[0].evaluate(() => document.documentElement.style.zoom), '1');

    assert.match(JSON.stringify(await tool('browser_snapshot')), /PAGE_ONE/);
    assert.notEqual((await tool('browser_tabs', {action: 'select', index: 1})).result.isError, true);
    assert.match(JSON.stringify(await tool('browser_snapshot')), /PAGE_TWO/);
    assert.equal((await f.gateway.getState()).busy, false);
  } finally {
    await f.gateway.close();
    await new Promise(resolve => site.close(resolve));
  }
});
