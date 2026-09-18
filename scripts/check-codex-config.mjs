import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// Read-only native configuration check. No thread, model turn, MCP tool call,
// configuration write or credential output is performed.
const executable = process.argv[2];
if (!executable) throw new Error('Supply the installed Codex executable path.');
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(executable, ['app-server', '--stdio'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const pending = new Map();
let nextId = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const handler = pending.get(message.id);
  if (handler) { pending.delete(message.id); handler(message); }
});
const exited = new Promise((resolve) => child.once('exit', resolve));
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native configuration check timed out.')); }, 15_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error('Native configuration request failed.'));
      else resolve(message.result);
    });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
try {
  await request('initialize', { clientInfo: { name: 'k_config_check', version: '0.1.0' } });
  child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
  const result = await request('config/read', { cwd: root, includeLayers: true });
  const server = result.config?.mcp_servers?.k_flash;
  process.stdout.write(`${JSON.stringify({
    nativeConfigRead: true, workspace: root, kFlashInEffectiveConfig: Boolean(server),
    layers: result.layers?.map((layer) => ({ name: layer.name, disabledReason: layer.disabledReason ?? null })),
  }, null, 2)}\n`);
} catch {
  process.stderr.write('Native configuration readback did not complete; no configuration was written.\n');
  process.exitCode = 1;
} finally {
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 3000);
  await exited;
  clearTimeout(timer);
  lines.close();
}
