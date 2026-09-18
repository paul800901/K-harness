#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runWorker, inspectJob } from './worker.mjs';

const HELP = `K HARNESS — Pi worker prototype

  npm run worker -- demo                    Offline scripted model; real Pi tools and records
  npm run worker -- inspect <job-directory> Read persisted result; never replay work
  npm run worker -- recover <job-directory> Read original task and current artifact inventory; no execution
  npm run worker -- models                  List the pinned local DeepSeek catalog; no API call
  npm run worker -- run <request.json> --live

Live execution requires the explicit --live flag, an exact model in request.json,
and DEEPSEEK_API_KEY already supplied to this process. No credential files are read.
Ctrl+C requests cancellation; existing output files are not rolled back or overwritten.
Optional request.coding grants exact editable inputs and fixed .mjs tests. Use only
an exclusively owned, non-sensitive workspace; this is not an OS sandbox.
`;

const controller = new AbortController();
const cancel = () => controller.abort(new Error('User requested cancellation.'));
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);

function progress(event) {
  if (event.type === 'job_started') process.stderr.write(`Job record: ${event.directory}\n`);
}

try {
  const [command, ...args] = process.argv.slice(2);
  let result;
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(HELP);
  } else if (command === 'demo' && args.length === 0) {
    const { runDemo } = await import('./demo.mjs');
    result = await runDemo({ signal: controller.signal, onEvent: progress });
  } else if (command === 'inspect' && args.length === 1) {
    result = await inspectJob(path.resolve(args[0]));
  } else if (command === 'recover' && args.length === 1) {
    const { inspectRecovery } = await import('./recovery.mjs');
    result = await inspectRecovery(path.resolve(args[0]));
  } else if (command === 'models' && args.length === 0) {
    const { createModelRuntime } = await import('./runtime.mjs');
    const runtime = await createModelRuntime();
    result = runtime.getModels('deepseek').map(({ id, name, api }) => ({ id, name, api }));
  } else if (command === 'run') {
    if (args.length !== 2 || args[1] !== '--live') throw new Error('Live runs require: run <request.json> --live');
    const request = JSON.parse(await readFile(path.resolve(args[0]), 'utf8'));
    const { createDeepSeekRuntime } = await import('./runtime.mjs');
    const runtime = await createDeepSeekRuntime(request.model, process.env.DEEPSEEK_API_KEY);
    result = await runWorker({
      task: request.task, workspace: request.workspace,
      readFiles: request.readFiles, outputFiles: request.outputFiles,
      thinkingLevel: request.thinkingLevel, coding: request.coding, historyIds: request.historyIds, ...runtime,
      signal: controller.signal, onEvent: progress,
    });
  } else {
    throw new Error('Unknown command or extra arguments. Use --help.');
  }
  if (result !== undefined) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === 'failed' || result.status === 'unresolved') process.exitCode = 1;
    if (result.status === 'cancelled') process.exitCode = 130;
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
