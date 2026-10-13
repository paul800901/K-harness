// Minimal fake Claude host / worker bridge / gateway for controller timing tests.
// Adapted from the 2026-10-14 Fable 5.1 audit reproductions (docs/k-audit-20261014.md).
import {mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createClaudeController} from '../../src/claude-controller.mjs';
import {scratchBase} from '../scratch.mjs';

export async function claudeTimingFixture({models, waitForHost, bridgeOverrides = {}, onChange, afterHost} = {}) {
  const root = await mkdtemp(path.join(scratchBase, 'claude-timing-'));
  await writeFile(path.join(root, 'README.md'), 'x');
  let hostOptions, gatewayOptions, host;
  const makeHost = () => {
    let resolveClosed;
    return {
      startCalls: [],
      closed: new Promise(resolve => {
        resolveClosed = resolve;
      }),
      resolveClosed() {
        resolveClosed();
      },
      async start(content) {
        this.startCalls.push(content);
      },
      async interrupt() {
        this.interrupted = true;
      },
      async close() {
        resolveClosed();
      }
    };
  };
  const bridge = {
    closed: false,
    async list() {
      return this.records ?? [];
    },
    async start(args) {
      this.records ??= [];
      return {...args, provider: 'codex'};
    },
    async cancel() {
      return {settled: true};
    },
    async wait() {
      return {settled: true};
    },
    async inspect() {
      return {settled: true};
    },
    async close() {
      this.closed = true;
    },
    ...bridgeOverrides
  };
  const gateway = {
    mcpConfig: {
      mcpServers: {k_luna: {type: 'http', url: 'http://127.0.0.1:4567/mcp', headers: {Authorization: 'Bearer t'}}}
    },
    closed: false,
    async close() {
      this.closed = true;
      await gatewayOptions.bridge.close();
    }
  };
  const controller = createClaudeController({
    root,
    executable: 'codex-test',
    commandSpec: {command: 'claude-test', argsPrefix: []},
    onChange: onChange ?? (() => {}),
    hostFactory: async options => {
      hostOptions = options;
      host = makeHost();
      host.models = models;
      await waitForHost?.(options, host);
      afterHost?.(host);
      return host;
    },
    bridgeFactory: async () => bridge,
    gatewayFactory: async options => {
      gatewayOptions = options;
      return gateway;
    }
  });
  return {
    root,
    controller,
    bridge,
    gateway,
    get host() {
      return host;
    },
    get hostOptions() {
      return hostOptions;
    },
    get gatewayOptions() {
      return gatewayOptions;
    }
  };
}
export const tick = () => new Promise(resolve => setImmediate(resolve));
export const settledWithin = (promise, ms = 200) =>
  Promise.race([promise.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), ms))]);
