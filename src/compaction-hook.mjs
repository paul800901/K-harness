// Trust only K's own compact handler using process-local native flags. Native
// thread config does not apply trust state, so discovery uses an empty host before
// any thread is started. Native discovery reads each layer separately: do not
// copy user/project handlers into flags (that would duplicate their definitions).
export const COMPACTION_HOOK = {
  matcher: '^compact$',
  hooks: [
    {
      type: 'mcp_tool',
      server: 'k_gemini',
      tool: 'conversation_context',
      input: {hook: true, sessionId: '${session_id}'},
      timeout: 10
    }
  ]
};
function toml(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return '[' + value.map(toml).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => JSON.stringify(k) + '=' + toml(v))
        .join(',') +
      '}'
    );
  throw Error('Native hook config cannot be represented; no thread started.');
}
export const COMPACTION_HOOK_FLAGS = ['hooks.SessionStart=' + toml([COMPACTION_HOOK])];
async function initialize(host) {
  await host.request('initialize', {
    clientInfo: {name: 'k_harness_compaction_prepare', version: '0.1.0'},
    capabilities: {experimentalApi: true}
  });
  host.notify({method: 'initialized', params: {}});
}
function ownHook(list, index) {
  const matches = (list.data ?? [])
    .flatMap(row => row.hooks ?? [])
    .filter(
      h =>
        h.source === 'sessionFlags' &&
        h.eventName === 'sessionStart' &&
        h.handlerType === 'mcpTool' &&
        h.server === 'k_gemini' &&
        h.tool === 'conversation_context' &&
        h.matcher === '^compact$' &&
        h.timeoutSec === 10 &&
        h.key?.endsWith(`:session_start:${index}:0`)
    );
  if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].currentHash))
    throw Error('K compact hook definition not confirmed; no thread started.');
  return matches[0];
}
export async function prepareCompactionHost({initial, factory, cwd}) {
  let current = initial;
  try {
    await initialize(current);
    const hook = ownHook(await current.request('hooks/list', {cwds: [cwd]}), 0);
    await current.close();
    current = null;
    current = factory({
      configOverrides: [
        ...COMPACTION_HOOK_FLAGS,
        'hooks.state=' + toml({[hook.key]: {enabled: true, trusted_hash: hook.currentHash}})
      ]
    });
    await initialize(current);
    const trusted = ownHook(await current.request('hooks/list', {cwds: [cwd]}), 0);
    if (
      trusted.key !== hook.key ||
      trusted.currentHash !== hook.currentHash ||
      trusted.trustStatus !== 'trusted' ||
      !trusted.enabled
    )
      throw Error('K compact hook trust not confirmed; no thread started.');
    return {...current, initialized: true};
  } catch (error) {
    await current?.close();
    throw error;
  }
}
