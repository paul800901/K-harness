import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {callGoogleSheets, createGoogleSheetsServer} from '../src/google-sheets-mcp.mjs';

const cli = path.resolve('owner-tools/google-sheets.mjs'),
  approved = ['test_sheet'];
test('Sheets reader only calls existing CLI meta/get without shell, injected environment or writes', async () => {
  const calls = [],
    signal = new AbortController().signal;
  const options = {
    signal,
    env: {PATH: 'path', USERPROFILE: 'profile', NODE_OPTIONS: '--bad', API_KEY: 'secret'},
    execImpl: async (...args) => {
      calls.push(args);
      return {stdout: '{"values":[[100]]}'};
    }
  };
  const metadata = await callGoogleSheets(cli, approved, 'sheets_metadata', {spreadsheetId: 'test_sheet'}, options);
  assert.ok(metadata.fetchedAt);
  assert.deepEqual(calls[0][1], [cli, 'meta', 'test_sheet']);
  const range = "'日 業績'!A1:AE50";
  await callGoogleSheets(cli, approved, 'sheets_read_values', {spreadsheetId: 'test_sheet', range}, options);
  assert.deepEqual(calls[1][1], [cli, 'get', 'test_sheet', range, '--render', 'UNFORMATTED_VALUE']);
  assert.deepEqual(calls[1][2].env, {PATH: 'path', USERPROFILE: 'profile'});
  assert.equal(calls[1][2].shell, false);
  assert.equal(calls[1][2].windowsHide, true);
  assert.equal(calls[1][2].signal, signal);
  for (const [name, args] of [
    ['sheets_update', {spreadsheetId: 'test_sheet'}],
    ['sheets_metadata', {spreadsheetId: 'other_sheet'}],
    ['sheets_metadata', {spreadsheetId: 'test_sheet', command: 'clear'}],
    ['sheets_read_values', {spreadsheetId: 'test_sheet', range: 'A1', render: 'invalid'}],
    ['sheets_read_values', {spreadsheetId: 'test_sheet', range: '--render'}],
    ['sheets_metadata', {spreadsheetId: '../test_sheet'}]
  ])
    await assert.rejects(callGoogleSheets(cli, approved, name, args, options));
  assert.equal(calls.length, 2);
});

test('Sheets MCP exposes only two read tools, rejects other sheets and returns safe diagnostics', async () => {
  const calls = [];
  let failure;
  const server = createGoogleSheetsServer({
    cli,
    spreadsheetIds: approved,
    call: async (...args) => {
      calls.push(args);
      if (failure) throw Object.assign(Error('private_secret'), {stderr: failure});
      return {fetchedAt: 'now', data: {values: [['amount'], [100]]}};
    }
  });
  const client = new Client({name: 'test', version: '1'}),
    [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(
      tools.map(t => t.name),
      ['sheets_metadata', 'sheets_read_values']
    );
    assert.ok(tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
    assert.match(tools[0].description, /test_sheet/);
    const invalid = await client.callTool({name: 'sheets_metadata', arguments: {spreadsheetId: 'other'}});
    assert.equal(invalid.isError, true);
    assert.equal(calls.length, 0);
    const result = await client.callTool({
      name: 'sheets_read_values',
      arguments: {spreadsheetId: 'test_sheet', range: 'A1:A2'}
    });
    assert.equal(JSON.parse(result.content[0].text).data.values[1][0], 100);
    for (const [stderr, pattern] of [
      ['storeops_write_oauth_failed private_secret', /授權不可用/],
      ['sheets_http_403 private_secret', /拒絕/],
      ['sheets_http_404 private_secret', /找不到/],
      ['sheets_http_400 private_secret', /範圍/],
      ['private_secret', /查詢未完成/]
    ]) {
      failure = stderr;
      const error = await client.callTool({name: 'sheets_metadata', arguments: {spreadsheetId: 'test_sheet'}});
      assert.equal(error.isError, true);
      assert.match(error.content[0].text, pattern);
      assert.doesNotMatch(JSON.stringify(error), /private_secret/);
    }
    assert.equal(calls.length, 6, 'one attempt per call; no automatic retry');
  } finally {
    await client.close();
    await server.close();
  }
});
