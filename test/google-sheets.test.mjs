import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Client, InMemoryTransport} from '@modelcontextprotocol/client';
import {readFile} from 'node:fs/promises';
import {callGoogleSheets, createGoogleSheetsServer, writeGoogleSheetRow} from '../src/google-sheets-mcp.mjs';

const cli = path.resolve('owner-tools/google-sheets.mjs'),
  approved = ['test_sheet'];
test('Sheets reader only calls existing CLI meta/get without shell or injected environment', async () => {
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

test('Sheets MCP exposes two read tools and one row writer, rejects other sheets and returns safe diagnostics', async () => {
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
      ['sheets_metadata', 'sheets_read_values', 'sheets_write_row']
    );
    assert.deepEqual(
      tools.map(t => t.annotations.readOnlyHint),
      [true, true, false]
    );
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

function fakeSheet(rows, {rowCount = 10, fail} = {}) {
  const calls = [];
  const cell = ref => {
    const [, col, row] = ref.match(/([A-Z]+)(\d+)$/u);
    return [Number(row), col.charCodeAt(0) - 65];
  };
  const execImpl = async (_node, [, command, , ...rest]) => {
    calls.push([command, ...rest]);
    if (command === 'meta') return {stdout: JSON.stringify({sheets: [{title: '日 業績', sheetId: 7, rowCount}]})};
    if (command === 'batch') {
      if (fail) throw Object.assign(Error('private_secret'), {stderr: fail});
      const {requests} = JSON.parse(await readFile(rest[0], 'utf8'));
      calls.at(-1).push(requests);
      for (const {updateCells: u} of requests.filter(r => r.updateCells)) {
        const v = u.rows[0].values[0].userEnteredValue ?? {};
        (rows[u.start.rowIndex] ??= [])[u.start.columnIndex] = v.numberValue ?? v.boolValue ?? v.stringValue ?? '';
      }
      return {stdout: '{}'};
    }
    const range = rest[0].split('!')[1];
    if (range === '1:1') return {stdout: JSON.stringify({values: [rows[0]]})};
    const [from, to] = range.split(':');
    if (/^[A-Z]+2$/u.test(from) && /^[A-Z]+$/u.test(to)) {
      const col = from.charCodeAt(0) - 65;
      let values = rows.slice(1).map(r => (r?.[col] === undefined || r[col] === '' ? [] : [r[col]]));
      while (values.length && !values.at(-1).length) values.pop();
      return {stdout: JSON.stringify({values})};
    }
    const [row] = cell(from);
    return {stdout: JSON.stringify({values: rows[row - 1]?.length ? [rows[row - 1]] : []})};
  };
  return {calls, options: {execImpl, env: {}}};
}

test('Sheets row writer locks columns by header and identity, then reads back', async () => {
  const rows = [['date', 'record_id', 'amount', 'note'], ['2026-10-16', 'PERF-1', 300, 'x']];
  const {calls, options} = fakeSheet(rows);
  const base = {spreadsheetId: 'test_sheet', sheet: '日 業績', idField: 'record_id'};
  const added = await writeGoogleSheetRow(
    cli,
    approved,
    {...base, mode: 'append', fields: {record_id: 'PERF-2', amount: 500, date: '2026-10-17', note: ''}},
    options
  );
  assert.equal(added.row, 3);
  assert.equal(added.verified, true);
  assert.deepEqual(added.after, {date: '2026-10-17', record_id: 'PERF-2', amount: 500});
  const batch = calls.find(c => c[0] === 'batch');
  assert.equal(batch[2].length, 3, 'blank append fields are not written');
  assert.deepEqual(batch[2][0].updateCells.start, {sheetId: 7, rowIndex: 2, columnIndex: 1});
  assert.deepEqual(batch[2][1].updateCells.rows[0].values[0], {userEnteredValue: {numberValue: 500}});

  const fixed = await writeGoogleSheetRow(
    cli,
    approved,
    {...base, mode: 'update', row: 3, fields: {record_id: 'PERF-2', note: 'cash', date: ''}},
    options
  );
  assert.equal(fixed.verified, true);
  assert.deepEqual(fixed.after, {record_id: 'PERF-2', amount: 500, note: 'cash'});

  const writes = calls.filter(c => c[0] === 'batch').length;
  for (const [args, pattern] of [
    [{...base, mode: 'append', fields: {record_id: 'PERF-1'}}, /已存在/],
    [{...base, mode: 'append', fields: {record_id: 'PERF-3', price: 1}}, /表頭/],
    [{...base, mode: 'append', fields: {amount: 1}}, /idField/],
    [{...base, mode: 'append', row: 9, fields: {record_id: 'PERF-3'}}, /不指定 row/],
    [{...base, mode: 'update', fields: {record_id: 'PERF-1'}}, /需要/],
    [{...base, mode: 'update', row: 2, fields: {record_id: 'PERF-2'}}, /不是/],
    [{...base, sheet: '其他', mode: 'append', fields: {record_id: 'PERF-3'}}, /找不到分頁/]
  ])
    await assert.rejects(writeGoogleSheetRow(cli, approved, args, options), pattern);
  for (const args of [
    {...base, mode: 'append', fields: {record_id: '=1+1'}},
    {...base, mode: 'append', fields: {}},
    {...base, spreadsheetId: 'other_sheet', mode: 'append', fields: {record_id: 'PERF-3'}}
  ])
    await assert.rejects(writeGoogleSheetRow(cli, approved, args, options));
  assert.equal(calls.filter(c => c[0] === 'batch').length, writes, 'rejected writes never reach Google');
});

test('Sheets row writer grows the grid, refuses dirty rows and reports unknown outcomes without retry', async () => {
  const full = fakeSheet([['id', 'v'], ['A', 1]], {rowCount: 2});
  const grown = await writeGoogleSheetRow(
    cli,
    approved,
    {spreadsheetId: 'test_sheet', sheet: '日 業績', idField: 'id', mode: 'append', fields: {id: 'B', v: 2}},
    full.options
  );
  assert.equal(grown.row, 3);
  assert.deepEqual(full.calls.find(c => c[0] === 'batch')[2][0], {
    appendDimension: {sheetId: 7, dimension: 'ROWS', length: 1}
  });

  const dirty = fakeSheet([['id', 'v'], ['A', 1], [undefined, 'stray']]);
  await assert.rejects(
    writeGoogleSheetRow(
      cli,
      approved,
      {spreadsheetId: 'test_sheet', sheet: '日 業績', idField: 'id', mode: 'append', fields: {id: 'B'}},
      dirty.options
    ),
    /不是空白列/
  );

  for (const [stderr, pattern] of [
    ['sheets_http_400 private_secret', /整批未套用/],
    ['timeout', /結果未知/]
  ]) {
    const failing = fakeSheet([['id'], ['A']], {fail: stderr});
    const result = await writeGoogleSheetRow(
      cli,
      approved,
      {spreadsheetId: 'test_sheet', sheet: '日 業績', idField: 'id', mode: 'append', fields: {id: 'B'}},
      failing.options
    ).catch(error => error);
    assert.match(result.kMessage, pattern);
    assert.equal(failing.calls.filter(c => c[0] === 'batch').length, 1);
  }
});
