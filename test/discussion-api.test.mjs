import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir, mkdtemp, writeFile, readFile, symlink} from 'node:fs/promises';
import http from 'node:http';
import JSZip from 'jszip';
import {
  createDiscussionApiConnections,
  discussionApiBaseUrl,
  createDiscussionKeyVault
} from '../src/discussion-api-connections.mjs';
import {createDiscussionReader} from '../src/discussion-read-tools.mjs';
import {openDiscussionApiSession} from '../src/discussion-api.mjs';
import {remoteRouteAllowed} from '../src/remote-access.mjs';
import {startDesktop} from '../src/desktop-server.mjs';
import {scratchBase} from './scratch.mjs';
const base = scratchBase;
await mkdir(base, {recursive: true});
const fixture = async () => {
  const root = await mkdtemp(path.join(base, 'discussion-api-')),
    keys = new Map(),
    vault = {
      async get(id) {
        return keys.get(id);
      },
      async set(id, key) {
        keys.set(id, key);
      },
      async remove(id) {
        keys.delete(id);
      }
    };
  return {root, keys, vault};
};
const stream = (deltas, finish = 'stop', done = true) =>
  new Response(
    [
      ...deltas.map(delta => `data: ${JSON.stringify({choices: [{index: 0, delta}]})}\r\n\r\n`),
      `data: ${JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: finish}]})}\r\n\r\n`,
      ...(done ? ['data: [DONE]\r\n\r\n'] : [])
    ].join(''),
    {headers: {'Content-Type': 'text/event-stream'}}
  );
test('API configuration keeps secrets in vault, supports explicit catalog discovery and preserves metadata on name edit', async () => {
  const f = await fixture();
  let requested;
  const c = createDiscussionApiConnections({
    ...f,
    fetchImpl: async (url, opts) => {
      requested = {url, opts};
      return Response.json({
        data: [
          {
            id: 'real-id',
            name: 'Real',
            effort: {supported_levels: ['low', 'high'], default_level: 'high'},
            context_window: 128000
          }
        ]
      });
    }
  });
  const {connection} = await c.save({
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/',
    apiKey: 'FAKE-test-secret',
    models: []
  });
  assert(connection.keyConfigured);
  assert(!JSON.stringify(await c.list()).includes('FAKE-test-secret'));
  assert(
    !(await readFile(path.join(f.root, '.local/discussion-api-connections.json'), 'utf8')).includes('FAKE-test-secret')
  );
  await c.discover({id: connection.id});
  assert.equal(requested.url, 'https://api.deepseek.com/models');
  assert.equal(requested.opts.headers.Authorization, 'Bearer FAKE-test-secret');
  assert.equal(requested.opts.redirect, 'error');
  await c.save({...connection, name: 'DS', models: [{id: 'real-id', name: 'New name'}]});
  const selected = await c.resolve({route: 'api', connectionId: connection.id, model: 'real-id'});
  assert.equal(selected.effort, 'high');
  assert.equal((await c.models()).models[0].route, 'api');
  assert.match(selected.displayName, /DS API/);
  await assert.rejects(c.resolve({route: 'api', connectionId: connection.id, model: 'invented'}), /未換模/);
  await assert.rejects(c.resolve({...selected, effort: 'ultra'}), /推理程度/);
  await assert.rejects(c.save({...connection, baseUrl: 'https://different.example'}), /重新填寫/);
  await c.remove({id: connection.id});
  assert.equal(f.keys.size, 0);
  assert.deepEqual(await c.list(), {connections: []});
});
test('configuration blocks mutation while discussion active, uses no raw provider error and performs no retries', async () => {
  const f = await fixture();
  let busy = false,
    count = 0;
  const c = createDiscussionApiConnections({
    ...f,
    isBusy: () => busy,
    fetchImpl: async () => {
      count++;
      return new Response('echo FAKE-secret', {status: 401});
    }
  });
  const {connection} = await c.save({
    name: 'Test',
    baseUrl: 'https://example.test/v1',
    apiKey: 'FAKE-secret',
    models: [{id: 'm'}]
  });
  busy = true;
  await assert.rejects(c.remove({id: connection.id}), /討論正在/);
  busy = false;
  await assert.rejects(
    c.discover({id: connection.id}),
    e => e.message.includes('401') && !e.message.includes('FAKE-secret')
  );
  assert.equal(count, 1);
  for (const url of ['http://example.com', 'https://key@example.com', 'https://example.com?key=x', 'file:///c:/'])
    assert.throws(() => discussionApiBaseUrl(url));
  assert.equal(discussionApiBaseUrl('http://127.0.0.1:123/v1/'), 'http://127.0.0.1:123/v1');
  assert.equal(remoteRouteAllowed('GET', '/api/discussion/models'), true);
  for (const method of ['GET', 'POST']) assert.equal(remoteRouteAllowed(method, '/api/discussion/connections'), false);
  assert.equal(remoteRouteAllowed('POST', '/api/discussion/connections/save'), false);
});
test('vault confines target namespace and sends fake key only over helper stdin contract', async () => {
  const calls = [],
    v = createDiscussionKeyVault({
      root: base,
      invoke: async p => {
        calls.push(p);
        return p.operation === 'read' ? {secret: 'FAKE'} : {stored: true};
      }
    }),
    id = 'a'.repeat(32);
  await v.set(id, 'FAKE');
  assert.equal(await v.get(id), 'FAKE');
  await v.remove(id);
  assert(calls.every(p => /^K-Harness\.DiscussionApi\.[a-f0-9]{64}\.[a-f0-9]{32}$/u.test(p.target)));
  await assert.rejects(v.get('../foreign'));
});
test('independent read tools read original files, return exact line evidence and deny outside, secrets, junctions, writes', async () => {
  const f = await fixture();
  await mkdir(path.join(f.root, 'docs'));
  await writeFile(path.join(f.root, 'docs/source.txt'), 'fact\nblind spot\nthird');
  await writeFile(path.join(f.root, '.env.local'), 'DO NOT READ');
  await symlink(path.dirname(f.root), path.join(f.root, 'link'), 'junction');
  const r = await createDiscussionReader(f.root);
  const list = await r('list_files', {recursive: true});
  assert(list.entries.some(e => e.path === 'docs/source.txt'));
  assert(!list.entries.some(e => e.path.startsWith('link') || e.path.startsWith('.env')));
  assert.equal((await r('search_files', {query: 'blind'})).matches[0].line, 2);
  assert.equal((await r('read_file', {path: 'docs/source.txt', startLine: 2, endLine: 2})).text, 'blind spot');
  for (const p of [
    '../source.txt',
    'C:\\source.txt',
    '/etc/passwd',
    '.env.local',
    '.env.local ',
    '.runtime/file',
    '.gemini/file',
    'agent-home/file',
    'link/file',
    'docs/source.txt:stream',
    'CON'
  ])
    await assert.rejects(r('read_file', {path: p}));
  await assert.rejects(r('write_file', {path: 'docs/source.txt', text: 'changed'}), /唯讀|只提供/);
  assert.equal(await readFile(path.join(f.root, 'docs/source.txt'), 'utf8'), 'fact\nblind spot\nthird');
});
test('API reader extracts original PDF/DOCX text and does not silently truncate large relevant text', async () => {
  const f = await fixture(),
    zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
  );
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Original DOCX evidence</w:t></w:r></w:p></w:body></w:document>'
  );
  await writeFile(path.join(f.root, 'source.docx'), await zip.generateAsync({type: 'nodebuffer'}));
  const content = 'BT /F1 12 Tf 40 100 Td (Original PDF evidence) Tj ET',
    objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    ];
  let pdf = '%PDF-1.4\n',
    offsets = [];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf +=
    'xref\n0 6\n0000000000 65535 f \n' +
    offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  await writeFile(path.join(f.root, 'source.pdf'), pdf);
  const original = 'relevant evidence\n'.repeat(10000);
  await writeFile(path.join(f.root, 'large.txt'), original);
  const r = await createDiscussionReader(f.root);
  assert.match((await r('read_file', {path: 'source.docx'})).text, /Original DOCX evidence/);
  assert.match((await r('read_file', {path: 'source.pdf'})).text, /Original PDF evidence/);
  assert.equal((await r('read_file', {path: 'large.txt'})).text, original);
});
test('real local fake API receives tool evidence, no host-only summary dependency, preserves reasoning across subsequent questions', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'original.md'), 'original evidence');
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    requests.push(JSON.parse(text));
    const i = requests.length;
    const response =
      i === 1
        ? stream(
            [
              {
                reasoning_content: 'private API reasoning',
                tool_calls: [
                  {
                    index: 0,
                    id: 'read-1',
                    type: 'function',
                    function: {name: 'read_file', arguments: '{"path":"original.md"}'}
                  }
                ]
              }
            ],
            'tool_calls'
          )
        : stream([{content: i === 2 ? 'found original evidence' : 'follow-up'}]);
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    res.end(await response.text());
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const s = await openDiscussionApiSession({
      workspace: f.root,
      selection: {route: 'api', connectionId: 'fake', model: 'exact-id'},
      connections: {
        async credentials() {
          return {baseUrl: `http://127.0.0.1:${server.address().port}`, key: 'FAKE'};
        }
      }
    });
    assert.equal(await s.ask('find the original'), 'found original evidence');
    assert.equal(await s.ask('next'), 'follow-up');
    assert.equal(JSON.parse(requests[1].messages.at(-1).content).text, 'original evidence');
    assert.equal(requests[2].messages[2].reasoning_content, 'private API reasoning');
    assert(requests.every(r => r.model === 'exact-id' && r.tools.length === 5));
    await s.close();
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});
test('API participant independently searches and reads public sources without sending model key to search service', async () => {
  const f = await fixture(),
    requests = [],
    web = [];
  const s = await openDiscussionApiSession({
    workspace: f.root,
    selection: {route: 'api', connectionId: 'fake', model: 'exact-id'},
    connections: {
      async credentials() {
        return {baseUrl: 'https://provider.example/v1', key: 'FAKE-model-key'};
      }
    },
    fetchImpl: async (url, opts) => {
      requests.push(JSON.parse(opts.body));
      return requests.length === 1
        ? stream(
            [
              {
                tool_calls: [
                  {
                    index: 0,
                    id: 'search',
                    function: {
                      name: 'web_search',
                      arguments: JSON.stringify({query: 'current source', objective: 'official evidence'})
                    }
                  },
                  {
                    index: 1,
                    id: 'page',
                    function: {
                      name: 'read_webpage',
                      arguments: JSON.stringify({urls: ['https://official.example/source']})
                    }
                  }
                ]
              }
            ],
            'tool_calls'
          )
        : stream([{content: 'independent current evidence'}]);
    },
    webFetchImpl: async (url, opts) => {
      web.push({url, opts});
      return Response.json({id: 1, result: {content: [{type: 'text', text: 'original public evidence'}]}});
    }
  });
  assert.equal(await s.ask('verify current data'), 'independent current evidence');
  assert.equal(web.length, 2);
  assert(web.every(c => !JSON.stringify(c).includes('FAKE-model-key')));
  assert.equal(JSON.parse(requests[1].messages.at(-1).content).content, 'original public evidence');
  assert(requests[0].tools.some(t => t.function.name === 'web_search'));
  await s.close();
});
test('stream fragments, multiple read calls and deny unknown tool without executing writes', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'a.txt'), 'unchanged');
  const bodies = [];
  let n = 0;
  const s = await openDiscussionApiSession({
    workspace: f.root,
    selection: {route: 'api', connectionId: 'f', model: 'm'},
    connections: {
      async credentials() {
        return {baseUrl: 'https://fake.test', key: 'FAKE'};
      }
    },
    fetchImpl: async (url, o) => {
      bodies.push(JSON.parse(o.body));
      return ++n === 1
        ? stream(
            [
              {
                tool_calls: [
                  {index: 0, id: 'c', function: {name: 'read_', arguments: '{"path":'}},
                  {index: 1, id: 'w', function: {name: 'write_file', arguments: '{}'}}
                ]
              },
              {tool_calls: [{index: 0, id: 'c', function: {name: 'file', arguments: '"a.txt"}'}}]}
            ],
            'tool_calls'
          )
        : stream([{content: 'answer'}]);
    }
  });
  assert.equal(await s.ask('q'), 'answer');
  assert.equal(Object.hasOwn(bodies[1].messages.at(-3), 'reasoning_content'), false);
  assert.equal(bodies[1].messages.at(-2).tool_call_id, 'c');
  assert.equal(JSON.parse(bodies[1].messages.at(-2).content).text, 'unchanged');
  assert.match(JSON.parse(bodies[1].messages.at(-1).content).error, /只提供/);
  assert.equal(await readFile(path.join(f.root, 'a.txt'), 'utf8'), 'unchanged');
  await s.close();
});
test('truncated stream and HTTP errors do not replay, and stopping aborts active request', async () => {
  const f = await fixture(),
    common = {
      workspace: f.root,
      selection: {route: 'api', connectionId: 'f', model: 'm'},
      connections: {
        async credentials() {
          return {baseUrl: 'https://fake.test', key: 'FAKE'};
        }
      }
    };
  let n = 0;
  const a = await openDiscussionApiSession({
    ...common,
    fetchImpl: async () => {
      n++;
      return stream([{content: 'partial'}], 'length');
    }
  });
  await assert.rejects(a.ask('q'), /未完整/);
  await assert.rejects(a.ask('later'), /已停止/);
  assert.equal(n, 1);
  await a.close();
  const b = await openDiscussionApiSession({
    ...common,
    fetchImpl: async () => new Response('FAKE echoed secret', {status: 429})
  });
  await assert.rejects(b.ask('q'), e => e.message.includes('429') && !e.message.includes('FAKE'));
  await b.close();
  let started;
  const ready = new Promise(r => (started = r));
  const c = await openDiscussionApiSession({
    ...common,
    fetchImpl: (url, o) =>
      new Promise((resolve, reject) => {
        started();
        o.signal.addEventListener('abort', () => reject(Error('abort')), {once: true});
      })
  });
  const pending = c.ask('q').then(
    () => false,
    () => true
  );
  await ready;
  await c.close();
  assert.equal(await pending, true);
});

test('HTTP rejection exposes the provider message but redacts the configured key and never retries', async () => {
  const f = await fixture(),
    key = 'FAKE-sensitive-key';
  for (const wrap of [message => ({error: {message}}), message => ({message})]) {
    let calls = 0;
    const s = await openDiscussionApiSession({
      workspace: f.root,
      selection: {route: 'api', connectionId: 'fake', model: 'exact-id'},
      connections: {
        async credentials() {
          return {baseUrl: 'https://provider.example/v1', key};
        }
      },
      fetchImpl: async () => {
        calls++;
        return Response.json(wrap(`messages[2].content must be a string; echoed key: ${key}\n${'x'.repeat(600)}`), {
          status: 400
        });
      }
    });
    try {
      await assert.rejects(s.ask('synthetic input'), error => {
        assert.match(error.message, /HTTP 400/);
        assert.match(error.message, /messages\[2\]\.content must be a string/);
        assert(!error.message.includes(key));
        assert(!error.message.includes('\n'));
        assert(error.message.length < 450);
        return true;
      });
      await assert.rejects(s.ask('not allowed to replay'), /已停止/);
      assert.equal(calls, 1);
    } finally {
      await s.close();
    }
  }
});

test('desktop API settings use existing authenticated explicit commands and never return key plaintext', async () => {
  const f = await fixture(),
    connections = createDiscussionApiConnections(f);
  const app = await startDesktop({
    root: f.root,
    port: 0,
    discussionApi: connections,
    controllerFactory: () => ({state: {status: 'idle', busy: false, messages: []}, async close() {}})
  });
  try {
    assert.equal((await fetch(app.origin + '/api/discussion/connections')).status, 403);
    const launch = await fetch(app.createLaunchUrl(), {redirect: 'manual'}),
      cookie = launch.headers.get('set-cookie').split(';')[0];
    const post = (data, explicit = true) =>
        fetch(app.origin + '/api/discussion/connections/save', {
          method: 'POST',
          headers: {cookie, 'Content-Type': 'application/json', ...(explicit ? {'X-K-Request': '1'} : {})},
          body: JSON.stringify(data)
        }),
      data = {
        name: 'Fake',
        baseUrl: 'https://example.test/v1',
        apiKey: 'FAKE-settings-secret',
        models: [{id: 'model'}]
      };
    assert.equal((await post(data, false)).status, 403);
    const result = await post(data);
    assert.equal(result.status, 200);
    assert(!(await result.text()).includes(data.apiKey));
    const catalog = await (await fetch(app.origin + '/api/discussion/models', {headers: {cookie}})).json();
    assert.equal(catalog.models[0].route, 'api');
  } finally {
    await app.close();
  }
});

test('an oversized tool result is withheld with a narrowing hint instead of being sent to the provider', async () => {
  const f = await fixture();
  await mkdir(path.join(f.root, 'many'));
  for (let i = 0; i < 3000; i++)
    await writeFile(path.join(f.root, 'many', `file-${String(i).padStart(4, '0')}.txt`), '');
  await writeFile(path.join(f.root, 'small.txt'), 'small file');
  const bodies = [];
  let n = 0;
  const s = await openDiscussionApiSession({
    workspace: f.root,
    selection: {route: 'api', connectionId: 'f', model: 'm'},
    connections: {
      async credentials() {
        return {baseUrl: 'https://fake.test', key: 'FAKE'};
      }
    },
    fetchImpl: async (url, o) => {
      bodies.push(JSON.parse(o.body));
      n++;
      if (n === 1)
        return stream(
          [
            {
              tool_calls: [
                {index: 0, id: 'all', function: {name: 'list_files', arguments: '{"path":".","recursive":true}'}}
              ]
            }
          ],
          'tool_calls'
        );
      if (n === 2)
        return stream(
          [{tool_calls: [{index: 0, id: 'one', function: {name: 'read_file', arguments: '{"path":"small.txt"}'}}]}],
          'tool_calls'
        );
      return stream([{content: 'answer'}]);
    }
  });
  assert.equal(await s.ask('q'), 'answer');
  const withheld = bodies[1].messages.at(-1);
  assert.equal(withheld.tool_call_id, 'all');
  assert.ok(withheld.content.length < 1000, 'the listing itself is not sent');
  assert.match(JSON.parse(withheld.content).error, /工具結果過長.*未送出也未截斷.*縮小範圍/su);
  assert.equal(JSON.parse(withheld.content).entries, 3002, 'the size helps the model narrow the next request');
  assert.equal(JSON.parse(bodies[2].messages.at(-1).content).text, 'small file', 'a normal result is sent in full');
  await s.close();
});
