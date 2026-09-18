import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u);
const idInput = z.strictObject({ requestId });
const codingInput = z.strictObject({
  editFiles: z.array(z.string()).min(1), testFiles: z.array(z.string()).min(1),
  timeoutMs: z.number().int().min(100).max(60_000).optional(),
});

// Return the handoff and evidence pointers, not another copy of the full task
// prompt or Pi conversation on every wait/inspect call.
function handoff(state, id) {
  const result = { requestId: state.jobId ?? id, jobDirectory: state.directory };
  for (const key of ['status', 'acceptance', 'workspace', 'outputFiles', 'coding', 'historyIds', 'provider', 'model', 'thinkingLevel',
    'output', 'partialOutput', 'sessionFile', 'modelTurns', 'toolCalls', 'toolErrors',
    'startedAt', 'finishedAt', 'cancelRequested', 'timedOut', 'note', 'error']) {
    if (state[key] !== undefined) result[key] = state[key];
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
}

export function createWorkerMcpServer({ dispatcher, workspace, model }) {
  const server = new McpServer({ name: 'k-flash-worker', version: '0.2.0' }, {
    instructions: [
      'K HARNESS delegates bounded nonclinical file tasks to DeepSeek. The parent owns judgment and acceptance.',
      'This Flash worker is optional, not mandatory and not the only worker route. Use it only when suitable; direct work and native GPT subagents remain available according to the parent runtime and user selection. Delegated image interpretation must use native gpt-5.6-luna, never this Flash worker.',
      'Use one stable requestId per task. After start, wait (default 60s); do not poll or resubmit on timeout.',
      'Completed means the worker stopped normally, not that its output is accepted. Independently inspect outputs.',
      'Optional historyIds grants on-demand text search of those same-workspace job records only. Approve non-sensitive history before sharing; historical content may contain private data and is not current authority. Changing history grants requires a new request ID.',
      'Unresolved means inspect existing evidence; never invent a new ID to retry unknown work.',
      `Workspace is fixed to ${workspace}; requested model is ${model}.`,
      'Default: explicitly listed UTF-8 inputs and new outputs, up to 256 KiB each. No edits unless coding is explicitly granted for this task.',
      'Optional coding names exact editFiles and read-only .mjs testFiles, all also in readFiles. It grants backed-up exact-fragment edits and a fixed Node test runner, never arbitrary commands.',
      'Coding is only for authorized non-sensitive, trusted code in an exclusively owned workspace. Node permissions are NOT an OS sandbox or network isolation. No clinical data, secrets, hostile code or directory browsing.',
      'Do not overlap coding edits with other tasks, even in another host. The dispatcher rejects known in-host file conflicts; it is not a cross-process lock.',
      'Cancelling a wait does not cancel the worker. Use k_worker_cancel then wait for its terminal state; existing files remain.',
      'The stdio host owns worker lifetime. Closing it requests cancellation; reconnecting reads records, not automatic resume.',
    ].join('\n'),
  });

  function tool(name, description, inputSchema, annotations, execute) {
    server.registerTool(name, { description, inputSchema, annotations }, async (args, context) => {
      try { return handoff(await execute(args, context), args.requestId); } catch {
        // Never serialize arbitrary exception messages or request arguments:
        // either can contain user data or provider diagnostics.
        return {
          isError: true,
          content: [{ type: 'text', text: 'Request rejected or result unavailable. Check the request ID, fixed workspace and existing job evidence. Do not automatically retry under a new ID.' }],
        };
      }
    });
  }

  tool('k_worker_start', 'Start one authorized Flash task; returns before completion. Optional coding grants exact editable files and fixed .mjs tests, only with explicit task authority. Reuse the same requestId only for identical task, file lists and coding grants.',
    z.strictObject({ requestId, task: z.string().refine((value) => value.trim().length > 0), readFiles: z.array(z.string()).default([]), outputFiles: z.array(z.string()).default([]), coding: codingInput.optional(), historyIds: z.array(requestId).max(20).optional() }),
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    (args) => dispatcher.start(args));
  tool('k_worker_wait', 'Wait for completion without polling. A timeout or cancelled wait leaves the worker running; returns handoff and evidence paths.',
    z.strictObject({ requestId, timeoutMs: z.number().int().min(0).max(60_000).default(60_000) }),
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    ({ requestId: id, timeoutMs }, context) => dispatcher.wait(id, { timeoutMs, signal: context.mcpReq.signal }));
  tool('k_worker_inspect', 'Read an existing task without running or replaying it. Use for recovery or a requested status check, not frequent polling.',
    idInput, { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    ({ requestId: id }) => dispatcher.inspect(id));
  tool('k_worker_cancel', 'Request cancellation of this host’s worker. Wait afterward to confirm its terminal state. Already-created files are retained.',
    idInput, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ({ requestId: id }) => dispatcher.cancel(id));
  return server;
}
