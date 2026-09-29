import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { spawn } from 'node:child_process';
import { createModelRuntime } from '../../src/runtime.mjs';
import { createDispatcher } from '../../src/dispatcher.mjs';
import { serveWorkerStdio } from '../../src/mcp-transport.mjs';

const [workspace, stateDir, mode] = process.argv.slice(2);
globalThis.fetch = async () => { throw new Error('Network is forbidden in the MCP fixture.'); };
const modelRuntime = await createModelRuntime();
const faux = fauxProvider({ provider: 'k-mcp-offline', models: [{ id: 'scripted', reasoning: false }] });
faux.setResponses(mode === 'history' ? [
  fauxAssistantMessage(fauxToolCall('search_history', { query: 'preserve' })),
  context => fauxAssistantMessage(context.messages.findLast(message => message.role === 'toolResult').content[0].text),
] : mode.startsWith('coding') ? [
  fauxAssistantMessage(fauxToolCall('run_tests', {})),
  fauxAssistantMessage(fauxToolCall('replace_code', { path: 'code.mjs', expectedText: 'a - b', newText: 'a + b' })),
  async (_context, options) => {
    if (mode === 'coding-hold') {
      process.stderr.write('FIXTURE_WAITING_AFTER_WRITE\n');
      await new Promise((resolve) => {
        if (options.signal.aborted) resolve();
        else options.signal.addEventListener('abort', resolve, { once: true });
      });
      return fauxAssistantMessage('', { stopReason: 'aborted' });
    }
    return fauxAssistantMessage(fauxToolCall('run_tests', {}));
  },
  fauxAssistantMessage('已修正 code.mjs，指定測試通過。'),
] : [
  fauxAssistantMessage(fauxToolCall('read_input', { path: 'input.txt' })),
  (context) => {
    const input = context.messages.findLast((message) => message.role === 'toolResult');
    return fauxAssistantMessage(fauxToolCall('write_output', { path: 'output.txt', text: input.content[0].text }));
  },
  async (_context, options) => {
    if (mode === 'crash') process.exit(23);
    if (mode === 'hold') {
      process.stderr.write('FIXTURE_WAITING_AFTER_WRITE\n');
      await new Promise((resolve) => {
        if (options.signal.aborted) resolve();
        else options.signal.addEventListener('abort', resolve, { once: true });
      });
      return fauxAssistantMessage('', { stopReason: 'aborted' });
    }
    return fauxAssistantMessage('已建立 output.txt，原文未變更。');
  },
]);
modelRuntime.registerNativeProvider(faux.provider);
// Explicit local test adapter only. Production coding has no host-spawn
// fallback; it receives its Sandboxie runner from the trusted owner launcher.
const testRunner = {
  env: Object.fromEntries(['SystemRoot', 'WINDIR'].filter((name) => process.env[name]).map((name) => [name, process.env[name]])),
  spawnImpl(command, args, options) {
    const child = spawn(command, args, options);
    child.terminate = () => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve({ confirmed: true });
      child.once('close', () => resolve({ confirmed: true }));
      child.kill('SIGKILL');
    });
    return child;
  },
};
const dispatcher = await createDispatcher({ workspace, stateDir, modelRuntime, model: faux.getModel(), testRunner });
serveWorkerStdio({ dispatcher, workspace, model: faux.getModel().id });
