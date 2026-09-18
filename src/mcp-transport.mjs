import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createWorkerMcpServer } from './mcp.mjs';

export function serveWorkerStdio(options) {
  const server = createWorkerMcpServer(options);
  let handle;
  let shutdown;
  function close() {
    if (!shutdown) shutdown = (async () => {
      try { await options.dispatcher.close(); } finally {
        await handle?.close();
        process.stdin.pause();
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
        process.stdin.removeListener('end', stop);
      }
    })();
    return shutdown;
  }
  function stop() {
    void close().catch(() => {
      process.stderr.write('K worker shutdown could not confirm all results; inspect job records before retry.\n');
      process.exitCode = 1;
    });
  }
  server.server.onclose = stop;
  handle = serveStdio(() => server, {
    onerror() { process.stderr.write('K worker MCP transport error; no request data logged.\n'); },
  });
  process.stdin.once('end', stop);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return { close };
}
