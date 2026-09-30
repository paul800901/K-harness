import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
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
    return fauxAssistantMessage('已修正，待主代理驗收。');
  },
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
const dispatcher = await createDispatcher({ workspace, stateDir, modelRuntime, model: faux.getModel() });
serveWorkerStdio({ dispatcher, workspace, model: faux.getModel().id });
