import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscussionWebReader, discussionWebTools} from '../src/discussion-web-tools.mjs';

test('discussion web search uses exact anonymous Exa tools and preserves source content and extraction scope', async () => {
  const calls = [],
    reader = createDiscussionWebReader({
      fetchImpl: async (url, options) => {
        calls.push({url, options, body: JSON.parse(options.body)});
        return new Response(
          'event: message\r\ndata: ' +
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                content: [
                  {type: 'text', text: 'https://official.example/page original source'},
                  {type: 'text', text: 'second original block'}
                ]
              }
            }) +
            '\r\n\r\n',
          {headers: {'Content-Type': 'text/event-stream'}}
        );
      }
    });
  const result = await reader('web_search', {
    query: 'current official specification',
    objective: 'Compare primary source and contrary evidence',
    numResults: 3
  });
  assert.match(result.content, /original source\nsecond original block/);
  assert(Number.isFinite(Date.parse(result.queriedAt)));
  const page = await reader('read_webpage', {urls: ['https://official.example/page'], maxCharacters: 100000});
  assert.equal(page.requestedMaxCharactersPerPage, 100000);
  assert.match(page.scope, /不能當作完整/);
  assert(
    calls.every(
      c =>
        c.url === 'https://mcp.exa.ai/mcp' && c.options.redirect === 'error' && !('Authorization' in c.options.headers)
    )
  );
  assert.equal(calls[0].body.params.name, 'web_search_exa');
  assert.deepEqual(calls[0].body.params.arguments, {
    query: 'current official specification',
    objective: 'Compare primary source and contrary evidence',
    numResults: 3
  });
  assert.equal(calls[1].body.params.name, 'web_fetch_exa');
  assert.equal(discussionWebTools.length, 2);
});
test('web tools reject private or credential URLs and non-read tools without invoking network', async () => {
  let calls = 0;
  const reader = createDiscussionWebReader({
    fetchImpl: async () => {
      calls++;
      return Response.json({});
    }
  });
  for (const url of [
    'file:///C:/secret',
    'http://localhost/file',
    'https://127.0.0.1',
    'http://10.1.2.3',
    'https://[::1]',
    'https://user:secret@example.com',
    'http://intranet'
  ])
    await assert.rejects(reader('read_webpage', {urls: [url]}));
  await assert.rejects(reader('agent_run', {}));
  await assert.rejects(reader('web_search', {query: 'missing objective'}));
  await assert.rejects(reader('web_search', {query: 'a', objective: 'b', numResults: 0}));
  assert.equal(calls, 0);
});
test('web tool failure is explicit, has no retry, exposes no upstream error body and respects cancellation', async () => {
  for (const response of [
    new Response('FAKE provider secret', {status: 429}),
    Response.json({id: 1, result: {isError: true, content: [{type: 'text', text: 'FAKE provider secret'}]}}),
    new Response('data: malformed\n\n'),
    Response.json({id: 1, result: {content: []}})
  ]) {
    let count = 0;
    const reader = createDiscussionWebReader({
      fetchImpl: async () => {
        count++;
        return response;
      }
    });
    await assert.rejects(reader('web_search', {query: 'a', objective: 'b'}), e => !e.message.includes('FAKE'));
    assert.equal(count, 1);
  }
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  await assert.rejects(
    createDiscussionWebReader({
      signal: abort.signal,
      fetchImpl: async () => {
        calls++;
      }
    })('web_search', {query: 'a', objective: 'b'}),
    {name: 'AbortError'}
  );
  assert.equal(calls, 0);
});
