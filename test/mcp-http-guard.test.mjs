import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {admitMcpRequest, readLimitedBody} from '../src/mcp-http-guard.mjs';

const host = '127.0.0.1:4321',
  token = 'secret-token';
const request = (overrides = {}) => ({
  socket: {remoteAddress: '127.0.0.1'},
  url: '/mcp',
  method: 'POST',
  ...overrides,
  headers: {host, authorization: `Bearer ${token}`, ...overrides.headers}
});
const response = () => {
  const res = {headers: {}, status: null, ended: false};
  res.setHeader = (name, value) => (res.headers[name] = value);
  res.writeHead = (status, headers = {}) => ((res.status = status), Object.assign(res.headers, headers), res);
  res.end = () => ((res.ended = true), res);
  return res;
};

test('MCP gateway front door admits only authenticated loopback POST /mcp for its own host', () => {
  const cases = [
    [{}, true, null],
    [{headers: {origin: `http://${host}`}}, true, null],
    [{socket: {remoteAddress: '::ffff:127.0.0.1'}}, true, null],
    [{socket: {remoteAddress: '192.168.1.5'}}, false, 403],
    [{headers: {host: 'localhost:4321'}}, false, 403],
    [{headers: {origin: 'http://evil.example'}}, false, 403],
    [{headers: {authorization: 'Bearer wrong-token'}}, false, 401],
    [{headers: {authorization: token}}, false, 401],
    [{url: '/other'}, false, 404],
    [{method: 'GET'}, false, 405]
  ];
  for (const [overrides, admitted, status] of cases) {
    const res = response();
    assert.equal(admitMcpRequest(request(overrides), res, {host, token}), admitted, JSON.stringify(overrides));
    assert.equal(res.status, status, JSON.stringify(overrides));
    assert.equal(res.ended, !admitted);
    if (status === 401) assert.equal(res.headers['WWW-Authenticate'], 'Bearer');
    if (status !== 403) assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});

test('an unset host (gateway not listening yet) rejects every request', () => {
  const res = response();
  assert.equal(admitMcpRequest(request(), res, {host: undefined, token}), false);
  assert.equal(res.status, 403);
});

test('request bodies are read up to the limit and rejected beyond it', async () => {
  assert.equal(String(await readLimitedBody(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), 4)), 'abcd');
  await assert.rejects(readLimitedBody(Readable.from([Buffer.from('abc'), Buffer.from('de')]), 4), /too large/u);
});
