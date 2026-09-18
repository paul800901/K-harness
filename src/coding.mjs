import { mkdir, mkdtemp, open, readFile, writeFile, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Type } from '@earendil-works/pi-ai';
import { checkedPath, MAX_TEXT_BYTES } from './files.mjs';

export const MAX_TEST_OUTPUT_BYTES = 64 * 1024;

// Trusted host configuration, never a model-supplied executable or shell command.
export function normalizeCoding(coding, readFiles, outputFiles) {
  if (coding == null) return null;
  const { editFiles, testFiles, timeoutMs = 10_000 } = coding;
  if (![editFiles, testFiles].every((list) => Array.isArray(list) && list.length && list.every((name) => typeof name === 'string'))) {
    throw new Error('Coding requires non-empty editFiles and testFiles allowlists.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new Error('Test timeout must be 100-60000 ms.');
  const edits = [...new Set(editFiles)];
  const tests = [...new Set(testFiles)];
  if (![...edits, ...tests].every((name) => readFiles.includes(name))) throw new Error('Every code and test file must also be an approved input.');
  if ([...edits, ...tests].some((name) => outputFiles.includes(name))) throw new Error('Coding files cannot be new outputs.');
  if (tests.some((name) => !name.endsWith('.mjs'))) throw new Error('The fixed test runner supports explicit .mjs tests only.');
  return { editFiles: edits, testFiles: tests, timeoutMs };
}

export async function createCodingTools(workspace, policy, readFiles, jobDirectory) {
  if (!policy) return [];
  const paths = new Map();
  for (const name of readFiles) paths.set(name, await checkedPath(workspace, name, false));
  const key = (target) => process.platform === 'win32' ? target.toLowerCase() : target;
  const tests = new Set(policy.testFiles.map((name) => key(paths.get(name))));
  for (const name of policy.editFiles) {
    if (tests.has(key(paths.get(name)))) throw new Error('Tests must remain read-only, including alternate path spellings.');
    if ((await lstat(paths.get(name))).nlink !== 1) throw new Error('Editing hard-linked files is not supported.');
  }
  return [{
    name: 'replace_code', label: 'Replace one exact approved code fragment',
    description: 'In an approved UTF-8 code file, replace the single exact occurrence of expectedText with newText. Read first; expectedText must be non-empty and unique. Other text stays unchanged. A durable full pre-edit backup is kept; no automatic rollback.',
    parameters: Type.Object({ path: Type.Union(policy.editFiles.map((name) => Type.Literal(name))), expectedText: Type.String(), newText: Type.String() }),
    executionMode: 'sequential',
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      if (!policy.editFiles.includes(args.path)) throw new Error('Code edit was not authorized.');
      if (!args.expectedText || args.expectedText === args.newText) throw new Error('No code change requested.');
      if (Buffer.byteLength(args.expectedText) > MAX_TEXT_BYTES || Buffer.byteLength(args.newText) > MAX_TEXT_BYTES) throw new Error('Code exceeds the text size limit.');
      const target = await checkedPath(workspace, args.path, false);
      const handle = await open(target, 'r+');
      try {
        const info = await handle.stat();
        if (info.nlink !== 1) throw new Error('Editing hard-linked files is not supported.');
        if (info.size > MAX_TEXT_BYTES) throw new Error('Code exceeds the text size limit.');
        const before = await handle.readFile();
        if (before.length > MAX_TEXT_BYTES) throw new Error('Code exceeds the text size limit.');
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(before);
        const at = text.indexOf(args.expectedText);
        if (at < 0) throw new Error('expectedText is stale or absent; read it again before editing.');
        if (text.indexOf(args.expectedText, at + 1) >= 0) throw new Error('expectedText is ambiguous; include enough surrounding text to match once.');
        const after = Buffer.from(text.slice(0, at) + args.newText + text.slice(at + args.expectedText.length), 'utf8');
        if (after.length > MAX_TEXT_BYTES) throw new Error('Code exceeds the text size limit.');
        const backupRoot = path.join(jobDirectory, 'edits');
        await mkdir(backupRoot, { recursive: true });
        const backup = await mkdtemp(path.join(backupRoot, 'edit-'));
        const original = await open(path.join(backup, 'before.txt'), 'wx');
        try { await original.writeFile(before); await original.sync(); } finally { await original.close(); }
        await writeFile(path.join(backup, 'target.json'), JSON.stringify({ path: args.path }), { flag: 'wx' });
        signal?.throwIfAborted();
        // Recheck after backup I/O. The host must still provide exclusive workspace
        // ownership: this is not a cross-process lock or filesystem transaction.
        const currentTarget = await checkedPath(workspace, args.path, false);
        const currentInfo = await lstat(currentTarget);
        if (currentInfo.ino !== info.ino || currentInfo.dev !== info.dev || currentInfo.nlink !== 1 || currentInfo.size !== before.length || !(await readFile(currentTarget)).equals(before)) {
          throw new Error('Code changed during backup; no edit applied.');
        }
        signal?.throwIfAborted();
        let offset = 0;
        while (offset < after.length) {
          const { bytesWritten } = await handle.write(after, offset, after.length - offset, offset);
          if (!bytesWritten) throw new Error('Incomplete code write; inspect the backup before retrying.');
          offset += bytesWritten;
        }
        await handle.truncate(after.length);
        await handle.sync();
        return { content: [{ type: 'text', text: `Updated ${args.path}; previous content saved in ${path.relative(jobDirectory, backup)}.` }], details: { path: args.path, bytes: after.length, backup: path.relative(jobDirectory, backup) } };
      } finally { await handle.close(); }
    },
  }, {
    name: 'run_tests', label: 'Run the host-approved Node tests',
    description: `Run only the fixed host-approved Node tests, with a ${policy.timeoutMs} ms timeout and bounded output. No command or arguments can be selected. A passing process is evidence, not independent acceptance.`,
    parameters: Type.Object({}), executionMode: 'sequential',
    async execute(_id, args, signal) {
      if (Object.keys(args).length) throw new Error('The test command has no model-selectable arguments.');
      signal?.throwIfAborted();
      const allowed = [];
      for (const name of readFiles) allowed.push(await checkedPath(workspace, name, false));
      const testPaths = [];
      for (const name of policy.testFiles) testPaths.push(await checkedPath(workspace, name, false));
      const directory = await mkdtemp(path.join(jobDirectory, 'test-'));
      const result = await runFixedTests(workspace, allowed, testPaths, policy.timeoutMs, signal);
      await writeFile(path.join(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { ...result, evidence: path.relative(jobDirectory, directory) } };
    },
  }];
}

// Defense against accidental access, NOT an OS sandbox for hostile code. Node
// 24.14 has no network permission flag; do not claim this blocks network access.
function runFixedTests(workspace, allowed, tests, timeoutMs, signal) {
  signal?.throwIfAborted();
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR']) if (process.env[name]) env[name] = process.env[name];
  // Import the exact files directly. `node --test <path>` performs directory
  // discovery on Windows, which would require unnecessarily broad read grants.
  // node:test still runs its tests and sets the process exit status on failure.
  const args = ['--permission', '--no-addons', '--test-reporter=tap',
    ...allowed.map((file) => `--allow-fs-read=${file}`), '--input-type=module', '--eval',
    'for (const file of process.argv.slice(1)) await import(file);', ...tests.map((file) => pathToFileURL(file).href)];
  const startedAt = new Date().toISOString();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: workspace, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let bytes = 0;
    let stopReason = null;
    const stop = (reason) => { stopReason ??= reason; child.kill('SIGKILL'); };
    const onAbort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const capture = (chunk) => {
      const remaining = MAX_TEST_OUTPUT_BYTES - bytes;
      const kept = chunk.subarray(0, remaining);
      if (kept.length) chunks.push(kept);
      bytes += kept.length;
      if (chunk.length > remaining) stop('output-limit');
    };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.once('error', () => { stopReason ??= 'spawn-error'; });
    child.once('close', (exitCode, terminationSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      resolve({ startedAt, finishedAt: new Date().toISOString(), exitCode, terminationSignal,
        status: stopReason ?? (exitCode === 0 ? 'passed' : 'failed'), output: Buffer.concat(chunks).toString('utf8') });
    });
  });
}
