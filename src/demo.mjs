import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createModelRuntime } from './runtime.mjs';
import { runWorker } from './worker.mjs';

// Scripted provider, actual Pi agent loop and file tools. No inference or credentials.
export async function runDemo({ signal, onEvent } = {}) {
  const base = fileURLToPath(new URL('../.runtime/demos/', import.meta.url));
  await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, 'demo-'));
  await writeFile(path.join(workspace, 'input.txt'), 'K HARNESS 本機驗證\n保留原始檔案。\n', { flag: 'wx' });
  const modelRuntime = await createModelRuntime();
  const faux = fauxProvider({ provider: 'k-offline-demo', models: [{ id: 'scripted-demo', reasoning: false }] });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('read_input', { path: 'input.txt' })),
    (context) => {
      const input = context.messages.findLast((message) => message.role === 'toolResult');
      const text = input?.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
      if (!text) throw new Error('The demo did not receive a real tool result.');
      return fauxAssistantMessage(fauxToolCall('write_output', { path: 'output.txt', text: `已讀取：\n${text}` }));
    },
    fauxAssistantMessage('已讀取 input.txt 並建立 output.txt。這是離線流程驗證，不是 DeepSeek 實測。'),
  ]);
  modelRuntime.registerNativeProvider(faux.provider);
  const result = await runWorker({
    task: '讀取 input.txt，將「已讀取：」與原文存成 output.txt，保留輸入檔。',
    workspace, readFiles: ['input.txt'], outputFiles: ['output.txt'],
    modelRuntime, model: faux.getModel(), signal, onEvent,
  });
  const input = await readFile(path.join(workspace, 'input.txt'), 'utf8');
  let output;
  try { output = await readFile(path.join(workspace, 'output.txt'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...result, offline: true, outputVerified: output === `已讀取：\n${input}`, scriptedModelCalls: faux.state.callCount };
}
