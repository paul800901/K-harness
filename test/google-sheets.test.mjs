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

test('Sheets MCP stays read-only without an owner write map, rejects other sheets and returns safe diagnostics', async () => {
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

// In-memory stand-in for the owner CLI: cells hold userEnteredValue objects.
function fakeSheet(rows, {rowCount = 10, fail, drop, onBatch} = {}) {
  const calls = [];
  const letters = index => String.fromCharCode(65 + index);
  const shown = raw => (raw?.formulaValue ? 'computed' : (Object.values(raw ?? {})[0] ?? ''));
  const execImpl = async (_node, [, command, , ...rest]) => {
    const entry = [command, ...rest];
    calls.push(entry);
    await new Promise(resolve => setImmediate(resolve));
    if (command === 'meta') return {stdout: JSON.stringify({sheets: [{title: '日 業績', sheetId: 7, rowCount}]})};
    if (command === 'batch') {
      if (fail) throw Object.assign(Error('private_secret'), {stderr: fail});
      const {requests} = JSON.parse(await readFile(rest[0], 'utf8'));
      entry.push(requests);
      if (drop) return {stdout: '{}'};
      for (const request of requests) {
        if (request.appendCells) {
          let last = rows.length;
          while (last > 1 && !rows[last - 1]?.some(raw => Object.keys(raw ?? {}).length)) last--;
          rows[last] = request.appendCells.rows[0].values.map(cell => cell.userEnteredValue ?? {});
        } else {
          const {start, rows: values} = request.updateCells;
          (rows[start.rowIndex] ??= [])[start.columnIndex] = values[0].values[0].userEnteredValue ?? {};
        }
      }
      onBatch?.(rows);
      return {stdout: '{}'};
    }
    const [from] = rest[0].split('!')[1].split(':');
    if (command === 'cells') {
      const row = Number(from.slice(1)),
        out = {};
      (rows[row - 1] ?? []).forEach((raw, index) => raw && (out[`日 業績!${letters(index)}${row}`] = raw));
      return {stdout: JSON.stringify(out)};
    }
    if (from === '1') return {stdout: JSON.stringify({values: [rows[0].map(shown)]})};
    const col = from.charCodeAt(0) - 65;
    const values = rows.slice(1).map(r => (shown(r?.[col]) === '' ? [] : [shown(r[col])]));
    while (values.length && !values.at(-1).length) values.pop();
    return {stdout: JSON.stringify({values})};
  };
  return {calls, rows, options: {execImpl, env: {}, writable: {test_sheet: {'日 業績': 'record_id'}}}};
}
const text = value => ({stringValue: value}),
  num = value => ({numberValue: value}),
  header = ['date', 'record_id', 'amount', 'note'].map(text),
  base = {spreadsheetId: 'test_sheet', sheet: '日 業績'};

test('Sheets row writer appends by header through Google, updates by identity and verifies raw values', async () => {
  const sheet = fakeSheet([header, [text('2026-10-16'), text('PERF-1'), num(300), text('x')]]);
  const results = await Promise.all(
    ['PERF-2', 'PERF-3'].map(id =>
      writeGoogleSheetRow(
        cli,
        approved,
        {...base, mode: 'append', fields: {record_id: id, amount: 500, date: '2026-10-17', note: ''}},
        sheet.options
      )
    )
  );
  assert.deepEqual(results.map(r => r.row).sort(), [3, 4], 'parallel appends land on separate rows');
  assert.ok(results.every(r => r.verified));
  assert.deepEqual(results[0].after, {date: '2026-10-17', record_id: 'PERF-2', amount: 500});
  const [append] = sheet.calls.find(c => c[0] === 'batch')[2];
  assert.equal(append.appendCells.sheetId, 7);
  assert.deepEqual(append.appendCells.rows[0].values.length, 4, 'full header width, blanks as empty cells');
  assert.deepEqual(append.appendCells.rows[0].values[2], {userEnteredValue: num(500)});
  assert.deepEqual(append.appendCells.rows[0].values[3], {});

  const fixed = await writeGoogleSheetRow(
    cli,
    approved,
    {...base, mode: 'update', row: 2, fields: {record_id: 'PERF-1', note: 'cash', date: ''}},
    sheet.options
  );
  assert.equal(fixed.verified, true);
  assert.deepEqual(fixed.before, {date: '2026-10-16', record_id: 'PERF-1', amount: 300, note: 'x'});
  assert.deepEqual(fixed.after, {record_id: 'PERF-1', amount: 300, note: 'cash'});
  assert.deepEqual(
    sheet.calls
      .filter(c => c[0] === 'batch')
      .at(-1)[2]
      .map(r => r.updateCells.start.columnIndex),
    [3, 0],
    'update never rewrites the identity cell'
  );
});

test('Sheets row writer rejects untrusted targets, identities and values before calling Google', async () => {
  const sheet = fakeSheet([
    header,
    [text('2026-10-16'), text('PERF-1'), num(300)],
    [text('2026-10-16'), num(7), num(300)],
    [text('2026-10-16'), {formulaValue: '="PERF-9"'}, num(300)]
  ]);
  for (const [args, pattern, options = sheet.options] of [
    [{...base, mode: 'append', fields: {record_id: 'PERF-1'}}, /已存在/],
    [{...base, mode: 'append', fields: {record_id: 'PERF-4', price: 1}}, /表頭/],
    [{...base, mode: 'append', fields: {amount: 1}}, /識別欄/],
    [{...base, mode: 'append', fields: {date: 'PERF-4'}}, /識別欄/],
    [{...base, mode: 'append', row: 9, fields: {record_id: 'PERF-4'}}, /不指定 row/],
    [{...base, mode: 'update', fields: {record_id: 'PERF-1', note: 'y'}}, /需要/],
    [{...base, mode: 'update', row: 2, fields: {record_id: 'PERF-2', note: 'y'}}, /不是/],
    [{...base, mode: 'update', row: 3, fields: {record_id: '7', note: 'y'}}, /不是/],
    [{...base, mode: 'update', row: 4, fields: {record_id: 'PERF-9', note: 'y'}}, /不是/],
    [{...base, mode: 'update', row: 2, fields: {record_id: 'PERF-1'}}, /沒有要修改/],
    [{...base, sheet: '其他', mode: 'append', fields: {record_id: 'PERF-4'}}, /未經本人核准寫入/],
    [{...base, mode: 'append', fields: {record_id: 'PERF-4'}}, /未經本人核准寫入/, {...sheet.options, writable: {}}]
  ])
    await assert.rejects(writeGoogleSheetRow(cli, approved, args, options), pattern);
  for (const args of [
    {...base, mode: 'append', fields: {record_id: '=1+1'}},
    {...base, mode: 'append', fields: {}},
    {...base, mode: 'append', idField: 'date', fields: {record_id: 'PERF-4'}},
    {...base, spreadsheetId: 'other_sheet', mode: 'append', fields: {record_id: 'PERF-4'}}
  ])
    await assert.rejects(writeGoogleSheetRow(cli, approved, args, sheet.options));
  assert.equal(sheet.calls.filter(c => c[0] === 'batch').length, 0);
});

test('Sheets row writer reports rejected, unknown and unverifiable outcomes without retry', async () => {
  const append = {...base, mode: 'append', fields: {record_id: 'PERF-2', amount: 1}};
  for (const [setup, pattern] of [
    [{fail: 'sheets_http_400 private_secret'}, /整批未套用/],
    [{fail: 'timeout'}, /結果未知/],
    [{drop: true}, /找到 0 列/]
  ]) {
    const sheet = fakeSheet([header, [text('d'), text('PERF-1')]], setup);
    const error = await writeGoogleSheetRow(cli, approved, append, sheet.options).catch(e => e);
    assert.match(error.kMessage, pattern);
    assert.equal(sheet.calls.filter(c => c[0] === 'batch').length, 1);
  }
  const moved = fakeSheet([header, [text('d'), text('PERF-1')]], {
    onBatch: rows => rows[0].splice(2, 0, text('inserted'))
  });
  const result = await writeGoogleSheetRow(cli, approved, append, moved.options);
  assert.equal(result.verified, false);
  assert.ok(result.mismatches.includes('第 1 列表頭在寫入期間改變'));

  const sheet = fakeSheet([header, [text('d'), text('PERF-1')]]);
  const server = createGoogleSheetsServer({
      cli,
      spreadsheetIds: approved,
      writable: sheet.options.writable,
      call: (c, ids, name, args, options) => callGoogleSheets(c, ids, name, args, {...sheet.options, ...options})
    }),
    client = new Client({name: 'test', version: '1'}),
    [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tool = (await client.listTools()).tools.find(t => t.name === 'sheets_write_row');
    assert.match(tool.description, /日 業績」（識別欄 record_id）/);
    assert.equal(tool.annotations.readOnlyHint, false);
    const refused = await client.callTool({
      name: 'sheets_write_row',
      arguments: {...base, mode: 'append', fields: {record_id: 'PERF-1'}}
    });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /已存在.*未寫入/);
    const done = await client.callTool({name: 'sheets_write_row', arguments: append});
    assert.equal(JSON.parse(done.content[0].text).verified, true);
  } finally {
    await client.close();
    await server.close();
  }
  assert.throws(() => createGoogleSheetsServer({cli, spreadsheetIds: approved, writable: {other_sheet: {a: 'b'}}}));
});
