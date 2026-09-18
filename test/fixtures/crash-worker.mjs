import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createModelRuntime } from '../../src/runtime.mjs';
import { runWorker } from '../../src/worker.mjs';

const [workspace, stateDir, mode] = process.argv.slice(2);
const modelRuntime = await createModelRuntime();
const faux = fauxProvider({ provider: 'k-crash-test', models: [{ id: 'scripted-crash', reasoning: false }] });
faux.setResponses(mode === 'before-first'
  ? [() => process.exit(23)]
  : [
    fauxAssistantMessage(fauxToolCall('write_output', { path: 'output.txt', text: '程序中斷前已寫入。' })),
    () => process.exit(23),
  ]);
modelRuntime.registerNativeProvider(faux.provider);
await runWorker({ task: 'Crash recovery test.', workspace, stateDir, outputFiles: ['output.txt'], modelRuntime, model: faux.getModel() });
throw new Error('The crash fixture should not reach a normal terminal state.');
