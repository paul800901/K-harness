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
