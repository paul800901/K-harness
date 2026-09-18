import { readFile } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import path from 'node:path';
import { validateWorkspace } from './workspaces.mjs';

async function main() {
  const { values } = parseArgs({ options: {
    live: { type: 'boolean' }, workspace: { type: 'string' }, model: { type: 'string' },
    'key-file': { type: 'string' }, 'state-dir': { type: 'string' },
  } });
  if (!values.live || !values.workspace || !values.model || !values['key-file']) {
    throw new Error('Explicit --live, --workspace, --model and --key-file are required.');
  }
  if (!path.isAbsolute(values.workspace) || !path.isAbsolute(values['key-file']) ||
      (values['state-dir'] && !path.isAbsolute(values['state-dir']))) throw new Error('Use absolute host paths.');
  const workspace = await validateWorkspace(values.workspace);
  // The explicit, already-authorized host file is never a tool argument.
  const apiKey = parseEnv((await readFile(values['key-file'], 'utf8')).replace(/^\uFEFF/u, '')).DEEPSEEK_API_KEY;
  const { createDeepSeekRuntime } = await import('./runtime.mjs');
  const { createDispatcher } = await import('./dispatcher.mjs');
  const { serveWorkerStdio } = await import('./mcp-transport.mjs');
  const runtime = await createDeepSeekRuntime(values.model, apiKey);
  const dispatcher = await createDispatcher({ workspace, ...runtime, ...(values['state-dir'] ? { stateDir: values['state-dir'] } : {}) });
  serveWorkerStdio({ dispatcher, workspace, model: values.model });
}

main().catch(() => {
  process.stderr.write('K worker MCP did not start. Check explicit --live, absolute workspace/key-file paths and configured model; credential values are never displayed.\n');
  process.exitCode = 1;
});
