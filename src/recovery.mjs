import { lstat, realpath } from 'node:fs/promises';
import { inspectJob, readTranscript } from './worker.mjs';
import { checkedPath } from './files.mjs';

// Read-only recovery evidence. This does not resume a provider session, infer
// acceptance from file existence, or decide that an old process is dead.
export async function inspectRecovery(directory) {
  const state = await inspectJob(directory);
  const root = await realpath(state.workspace);
  const transcript = await readTranscript(directory);
  const results = transcript.filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult').map((entry) => entry.message);
  const names = [...new Set([...(state.readFiles ?? []), ...(state.outputFiles ?? []), ...(state.coding?.editFiles ?? [])])];
  const files = [];
  for (const name of names) {
    const file = { path: name, roles: [], observation: 'unavailable' };
    if (state.readFiles?.includes(name)) file.roles.push('input');
    if (state.outputFiles?.includes(name)) file.roles.push('output');
    if (state.coding?.editFiles?.includes(name)) file.roles.push('editable-code');
    file.recordedSuccessfulWrite = results.some((result) => !result.isError && ['write_output', 'replace_code'].includes(result.toolName) && result.details?.path === name);
    try {
      const target = await checkedPath(root, name, false);
      const info = await lstat(target);
      file.observation = 'present'; file.bytes = info.size;
    } catch (error) {
      file.observation = error.code === 'ENOENT' ? 'missing' : 'unavailable';
      // Do not expose arbitrary path/provider diagnostics or read file contents.
    }
    files.push(file);
  }
  return {
    sourceJobDirectory: state.directory ?? directory, status: state.status,
    originalTask: state.task, workspace: root,
    model: { provider: state.provider, id: state.model },
    priorOutput: state.output ?? '', partialOutput: state.partialOutput ?? '',
    files, acceptance: 'not-reviewed',
    recovery: 'inspection-only',
    instructions: [
      'Confirm the previous worker has stopped before any new mutation; unresolved does not prove it is dead.',
      'Read and validate present artifacts against the original task. Presence and recorded tool success are not acceptance.',
      'A missing tool result does not prove no write occurred. Inspect current files before retrying.',
      'After resolving uncertainty, explicitly authorize only remaining work with a new job ID and read-only grants for accepted artifacts.',
      'This is a new bounded handoff, not automatic session resume, memory compaction, or replay.',
    ],
  };
}
