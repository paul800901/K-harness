import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCompactionHost, COMPACTION_HOOK, COMPACTION_HOOK_FLAGS} from '../src/compaction-hook.mjs';
test('compact hook preserves inherited handlers, trusts only exact discovered hash before any work', async () => {
  const calls = [],
    hosts = [];
  const existing = {matcher: 'startup', hooks: [{type: 'command', command: 'existing'}]};
  const hook = {
    key: 'flags:session_start:0:0',
    currentHash: 'sha256:' + '1'.repeat(64),
    source: 'sessionFlags',
    eventName: 'sessionStart',
    handlerType: 'mcpTool',
    server: 'k_gemini',
    tool: 'conversation_context',
    matcher: '^compact$',
    timeoutSec: 10,
    enabled: true
  };
  const factory = options => {
    const n = hosts.length;
    const h = {
      options,
      notify() {},
      async close() {
        calls.push([n, 'close']);
      },
      async request(method) {
        calls.push([n, method]);
        if (method === 'config/read') return {config: {hooks: {SessionStart: [existing]}}};
        if (method === 'hooks/list')
          return {
            data: [
              {
                hooks: [
                  {key: 'original-user-key', source: 'user', trustStatus: 'trusted'},
                  {...hook, trustStatus: n === 1 ? 'trusted' : 'untrusted'}
                ]
              }
            ]
          };
        return {};
      }
    };
    hosts.push(h);
    return h;
  };
  const h = await prepareCompactionHost({
    initial: factory({configOverrides: COMPACTION_HOOK_FLAGS}),
    factory,
    cwd: 'test'
  });
  assert.equal(h.initialized, true);
  assert.equal(hosts.length, 2);
  assert.ok(!hosts[1].options.configOverrides[0].includes('existing'));
  assert.ok(hosts[1].options.configOverrides[0].includes('${session_id}'));
  assert.equal(hosts[1].options.configOverrides.length, 2);
  assert.ok(hosts[1].options.configOverrides[1].includes(hook.currentHash));
  assert.ok(!calls.some(([, m]) => m.startsWith('thread/') || m.startsWith('config/value')));
  assert.deepEqual(COMPACTION_HOOK.hooks[0].input, {hook: true, sessionId: '${session_id}'});
  await h.close();
});
test('unknown hook definition closes empty discovery host without bypass or work', async () => {
  let closes = 0,
    starts = 0;
  const factory = () => ({
    notify() {},
    close: async () => {
      closes++;
    },
    request: async method => {
      if (method.startsWith('thread/')) starts++;
      return method === 'config/read' ? {config: {}} : {data: []};
    }
  });
  await assert.rejects(prepareCompactionHost({initial: factory(), factory, cwd: 'test'}), /definition not confirmed/);
  assert.equal(closes, 1);
  assert.equal(starts, 0);
});
