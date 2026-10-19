import test from 'node:test';
import assert from 'node:assert/strict';
import {gemmaRequest, gemmaResponseEvents, openGemmaResponses} from '../src/gemma-responses.mjs';
const tools = [
  {type: 'function', name: 'exec_command', parameters: {type: 'object'}},
  {type: 'custom', name: 'apply_patch', description: 'Full patch syntax'},
  {
    type: 'namespace',
    name: 'mcp__k_gemini',
    tools: [{type: 'function', name: 'conversation_context', parameters: {type: 'object'}}]
  }
];

test('stop during model preparation finishes preparation but sends no inference', async () => {
  let entered, release, finished;
  const preparing = new Promise(resolve => {
    entered = resolve;
  });
  const prepared = new Promise(resolve => {
    release = resolve;
  });
  const finishing = new Promise(resolve => {
    finished = resolve;
  });
  const bridge = await openGemmaResponses('http://127.0.0.1:1234/v1', {
    expectedModel: 'qwen',
    acquireModel: async ({signal}) => {
      entered(signal);
      await prepared;
      return {model: 'k-qwen', finish: value => finished(value)};
    },
    fetchImpl: async () => assert.fail('cancelled work must never infer')
  });
  const abort = new AbortController();
  const result = fetch(`${bridge.baseUrl}/responses`, {
    method: 'POST',
    headers: bridge.headers,
    body: JSON.stringify({model: 'qwen'}),
    signal: abort.signal
  }).catch(error => error);
  try {
    const nativeSignal = await preparing;
    abort.abort();
    await result;
    const closed = bridge.close();
    assert.equal(nativeSignal.aborted, true);
    release();
    assert.deepEqual(await finishing, {settled: true});
    await closed;
  } finally {
    release();
  }
});

test('client cancellation is forwarded and bridge shutdown waits for exact owned-request cleanup', async () => {
  let finishCleanup;
  const cleanup = new Promise(resolve => {
    finishCleanup = resolve;
  });
  let finished;
  const finishing = new Promise(resolve => {
    finished = resolve;
  });
  let receivedSignal;
  let closeStarted = false;
  const bridge = await openGemmaResponses('http://127.0.0.1:1234/v1', {
    expectedModel: 'qwen',
    acquireModel: async () => ({
      model: 'k-qwen',
      async finish(value) {
        finished(value);
        await cleanup;
      }
    }),
    fetchImpl: async (_url, {signal}) => {
      receivedSignal = signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"type":"response.created"}\n\n'));
            signal.addEventListener('abort', () => controller.error(signal.reason), {once: true});
          }
        }),
        {headers: {'content-type': 'text/event-stream'}}
      );
    }
  });
  try {
    const result = await fetch(`${bridge.baseUrl}/responses`, {
      method: 'POST',
      headers: bridge.headers,
      body: JSON.stringify({model: 'qwen', stream: true})
    });
    const reader = result.body.getReader();
    await reader.read();
    await reader.cancel();
    assert.deepEqual(await finishing, {settled: false, cancelled: true});
    assert.equal(receivedSignal.aborted, true);
    let closed = false;
    closeStarted = true;
    const closing = bridge.close().then(() => {
      closed = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    finishCleanup();
    await closing;
  } finally {
    finishCleanup();
    if (!closeStarted) await bridge.close();
  }
});

test('local model preparation failure never sends inference or retries and preserves its explanation', async () => {
  let acquired = 0;
  const bridge = await openGemmaResponses('http://127.0.0.1:1234/v1', {
    expectedModel: 'qwen',
    fetchImpl: async () => assert.fail('must not send inference'),
    acquireModel: async () => {
      acquired++;
      throw Error('本機模型仍在工作；未停止或改用其他模型。');
    }
  });
  try {
    const result = await fetch(`${bridge.baseUrl}/responses`, {
      method: 'POST',
      headers: bridge.headers,
      body: JSON.stringify({model: 'qwen'})
    });
    assert.equal(result.status, 503);
    assert.match((await result.json()).error.message, /仍在工作/);
    assert.equal(acquired, 1);
  } finally {
    await bridge.close();
  }
});

test('local lease treats broken or unterminated streams as unknown, and terminal streams as settled', async () => {
  for (const terminal of [false, true, 'network-error']) {
    const finishes = [];
    const bridge = await openGemmaResponses('http://127.0.0.1:1234/v1', {
      expectedModel: 'qwen',
      acquireModel: async () => ({model: 'k-qwen', finish: value => finishes.push(value)}),
      fetchImpl: async (_url, options) => {
        assert.equal(JSON.parse(options.body).model, 'k-qwen');
        if (terminal === 'network-error') throw Error('synthetic disconnect');
        const text = terminal
          ? 'data: {"type":"response.completed","response":{"output":[]}}\n\n'
          : 'data: {"type":"response.created"}\n\n';
        return new Response(text, {headers: {'content-type': 'text/event-stream'}});
      }
    });
    try {
      const result = await fetch(`${bridge.baseUrl}/responses`, {
        method: 'POST',
        headers: bridge.headers,
        body: JSON.stringify({model: 'qwen', stream: true})
      });
      await result.text();
      assert.deepEqual(finishes, [{settled: terminal === true}]);
    } finally {
      await bridge.close();
    }
  }
});
test('Gemma tool normalization preserves all native tools and replays custom/namespaced history as functions', () => {
  const result = gemmaRequest({
    model: 'gemma',
    tools,
    input: [
      {type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** End Patch', call_id: 'c'},
      {type: 'custom_tool_call_output', call_id: 'c', output: 'success'},
      {type: 'function_call', namespace: 'mcp__k_gemini', name: 'conversation_context', arguments: '{}', call_id: 'm'}
    ]
  });
  assert.equal(result.body.tools.length, 3);
  assert(result.body.tools.every(t => t.type === 'function'));
  assert.equal(result.body.tools[2].name, 'mcp__k_gemini__conversation_context');
  assert.equal(result.body.input[0].arguments, JSON.stringify({input: '*** Begin Patch\n*** End Patch'}));
  assert.equal(result.body.input[1].type, 'function_call_output');
  assert.equal(result.body.input[2].namespace, undefined);
  assert.throws(() => gemmaRequest({tools: [{type: 'unknown'}]}), /尚未支援/);
});
test('stream translation buffers custom JSON until valid and preserves native namespace and call IDs', () => {
  const {aliases} = gemmaRequest({tools});
  const translate = gemmaResponseEvents(aliases);
  const item = {type: 'function_call', id: 'fc1', name: 'apply_patch', call_id: 'c1', arguments: ''};
  const start = translate({type: 'response.output_item.added', item, output_index: 0});
  assert.equal(start[0].item.type, 'custom_tool_call');
  assert.deepEqual(
    translate({type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"input":"台'}),
    []
  );
  assert.deepEqual(translate({type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '灣"}'}), []);
  const done = translate({
    type: 'response.output_item.done',
    output_index: 0,
    item: {...item, arguments: '{"input":"台灣"}'}
  });
  assert.equal(done[0].delta, '台灣');
  assert.equal(done[2].item.input, '台灣');
  assert.equal(done[2].item.call_id, 'c1');
  const namespace = translate({
    type: 'response.output_item.done',
    item: {type: 'function_call', name: 'mcp__k_gemini__conversation_context', arguments: '{}', call_id: 'm'}
  });
  assert.equal(namespace[0].item.namespace, 'mcp__k_gemini');
  assert.equal(namespace[0].item.name, 'conversation_context');
});
test('loopback bridge sends exactly one request, preserves error status, never forwards caller auth and closes', async () => {
  const calls = [];
  const server = await openGemmaResponses('http://127.0.0.1:18080/v1', {
    fetchImpl: async (url, options) => {
      calls.push({url, options});
      return new Response(JSON.stringify({error: 'offline'}), {
        status: 503,
        headers: {'content-type': 'application/json'}
      });
    }
  });
  try {
    const response = await fetch(`${server.baseUrl}/responses`, {
      method: 'POST',
      headers: server.headers,
      body: JSON.stringify({model: 'gemma', tools})
    });
    assert.equal(response.status, 503);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:18080/v1/responses');
    assert.equal(calls[0].options.headers.authorization, undefined);
    assert.equal(JSON.parse(calls[0].options.body).tools.length, 3);
    const denied = await fetch(`${server.baseUrl}/responses`, {method: 'POST', body: '{}'});
    assert.equal(denied.status, 403);
    const browser = await fetch(`${server.baseUrl}/responses`, {
      method: 'POST',
      headers: {...server.headers, Origin: new URL(server.baseUrl).origin},
      body: '{}'
    });
    assert.equal(browser.status, 403);
    assert.equal(calls.length, 1);
  } finally {
    await server.close();
  }
});

test('deterministic request errors return 400 without upstream inference', async () => {
  let calls = 0;
  const server = await openGemmaResponses('http://127.0.0.1:18080/v1', {
    fetchImpl: async () => {
      calls++;
      throw Error('must not infer');
    }
  });
  try {
    for (const body of ['bad-json', JSON.stringify({tools: [{type: 'unsupported'}]})]) {
      const response = await fetch(`${server.baseUrl}/responses`, {method: 'POST', headers: server.headers, body});
      assert.equal(response.status, 400);
      assert.match(await response.text(), /未送出推論/);
    }
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test('malformed custom wrappers remain native tool input, not broken streams or retries', () => {
  const {aliases} = gemmaRequest({tools});
  for (const args of ['{bad-json', '{"wrong":"field"}', 'null']) {
    const translate = gemmaResponseEvents(aliases);
    translate({
      type: 'response.output_item.added',
      item: {
        type: 'function_call',
        name: 'apply_patch',
        id: 'patch',
        call_id: 'call',
        arguments: ''
      }
    });
    const [delta, done] = translate({type: 'response.function_call_arguments.done', item_id: 'patch', arguments: args});
    assert.equal(delta.delta, args);
    assert.equal(done.input, args);
    const result = translate({
      type: 'response.completed',
      response: {output: [{type: 'function_call', name: 'apply_patch', id: 'patch', call_id: 'call', arguments: args}]}
    });
    assert.equal(result[0].response.output[0].input, args);
    assert.equal(result[0].response.output[0].call_id, 'call');
  }
});

test('HTTP SSE bridge preserves split Unicode, namespace tools and completed custom calls', async () => {
  const events = [
    {
      type: 'response.output_item.added',
      item: {type: 'function_call', name: 'apply_patch', id: 'p', call_id: 'c', arguments: ''}
    },
    {type: 'response.function_call_arguments.delta', item_id: 'p', delta: '{"input":"台灣"}'},
    {
      type: 'response.output_item.done',
      item: {type: 'function_call', name: 'apply_patch', id: 'p', call_id: 'c', arguments: '{"input":"台灣"}'}
    },
    {
      type: 'response.output_item.done',
      item: {type: 'function_call', name: 'mcp__k_gemini__conversation_context', id: 'm', call_id: 'k', arguments: '{}'}
    },
    {type: 'response.completed', response: {output: []}}
  ];
  const wire = Buffer.from(
    events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
  );
  let calls = 0;
  const server = await openGemmaResponses('http://127.0.0.1:18080/v1', {
    fetchImpl: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < wire.length; i += 7) controller.enqueue(wire.subarray(i, i + 7));
            controller.close();
          }
        }),
        {headers: {'content-type': 'text/event-stream'}}
      );
    }
  });
  try {
    const response = await fetch(`${server.baseUrl}/responses`, {
      method: 'POST',
      headers: server.headers,
      body: JSON.stringify({tools, input: [], stream: true})
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.match(text, /"input":"台灣"/);
    assert.match(text, /"namespace":"mcp__k_gemini"/);
    assert.match(text, /response.completed/);
    assert.match(text, /data: \[DONE\]/);
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});
