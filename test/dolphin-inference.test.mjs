import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fetchDolphinInference, openGemmaResponses} from '../src/gemma-responses.mjs';

async function serverFor(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
      })
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test('Dolphin transport times out idle headers and idle body, without retrying', async t => {
  let calls = 0;
  const url = await serverFor(t, (req, res) => {
    calls++;
    if (req.url === '/body') {
      res.writeHead(200, {'content-type': 'text/plain'});
      res.write('partial');
    }
  });
  await assert.rejects(fetchDolphinInference(`${url}/headers`, {idleTimeoutMs: 150}), /閒置逾時/);
  const response = await fetchDolphinInference(`${url}/body`, {idleTimeoutMs: 150});
  await assert.rejects(response.text());
  assert.equal(calls, 2);
});

test('Dolphin transport keeps streaming and propagates cancellation after headers', async t => {
  const url = await serverFor(t, (req, res) => {
    res.write('first');
    const timer = setInterval(() => res.write('-next'), 40);
    res.once('close', () => clearInterval(timer));
  });
  const controller = new AbortController();
  const response = await fetchDolphinInference(url, {idleTimeoutMs: 500, signal: controller.signal});
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
  assert.match(new TextDecoder().decode((await reader.read()).value), /next/);
  controller.abort();
  await assert.rejects(async () => {
    while (!(await reader.read()).done) {}
  });
});

test('Dolphin transport refuses redirects and preserves error bodies and request data', async t => {
  let targetCalls = 0,
    received;
  const url = await serverFor(t, async (req, res) => {
    if (req.url === '/redirect') return res.writeHead(302, {location: '/target'}).end();
    if (req.url === '/target') targetCalls++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = {method: req.method, body: Buffer.concat(chunks).toString(), header: req.headers['content-type']};
    res.writeHead(400, {'content-type': 'application/json'}).end('{"error":"diagnostic"}');
  });
  await assert.rejects(fetchDolphinInference(`${url}/redirect`, {}), /不得重新導向/);
  assert.equal(targetCalls, 0);
  const result = await fetchDolphinInference(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: '{"test":true}'
  });
  assert.equal(result.status, 400);
  assert.equal(result.headers.get('content-type'), 'application/json');
  assert.deepEqual(await result.json(), {error: 'diagnostic'});
  assert.deepEqual(received, {method: 'POST', body: '{"test":true}', header: 'application/json'});
});

test('Dolphin transport passes real SSE frames through the existing K bridge', async t => {
  const event = {type: 'response.completed', response: {output: []}};
  const url = await serverFor(t, (req, res) => {
    res.writeHead(200, {'content-type': 'text/event-stream'});
    res.write('event: response.completed\ndata: ');
    setImmediate(() => res.end(`${JSON.stringify(event)}\n\ndata: [DONE]\n\n`));
  });
  const bridge = await openGemmaResponses(`${url}/v1`, {fetchImpl: fetchDolphinInference});
  t.after(() => bridge.close());
  const response = await fetch(`${bridge.baseUrl}/responses`, {
    method: 'POST',
    headers: bridge.headers,
    body: JSON.stringify({stream: true, model: 'dolphin', tools: [], input: []})
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), `event: response.completed\ndata: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
});
