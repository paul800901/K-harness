// Bounded fake-data integration fixture. This file does not register the host
// or run Chrome automatically when imported; invoke it explicitly with --root.
import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';
import { createExternalBrowserGateway } from '../src/external-browser-gateway.mjs';
import { createChromeExtensionContext } from '../src/chrome-extension-context.mjs';
import { openChromeConnectPageViaNative } from '../src/chrome-native-connection.mjs';
import { K_EXTENSION_ID, validateHostConfig } from './k-browser-native-host.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(projectRoot, '.runtime', 'browser-native-connection');
const chromiumPath = path.join(projectRoot, '.runtime', 'playwright-browsers', 'chromium-1246', 'chrome-win64', 'chrome.exe');
const extensionPath = path.join(projectRoot, 'browser-extension', 'dist');
const execFile = promisify(execFileCallback);
let resultRoot;
let resultPath;
const deadlineAt = Date.now() + 90_000;

function parsePreparedRoot(argv) {
  if (argv.length !== 2 || argv[0] !== '--root' || !path.isAbsolute(argv[1]))
    throw new Error('Usage: node scripts/verify-browser-native-connection.mjs --root <absolute-preparedRoot>');
  return path.resolve(argv[1]);
}

function extensionIdFromManifest(manifest) {
  if (typeof manifest.key !== 'string') throw new Error('Built extension manifest has no stable key.');
  return createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
    .slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + Number.parseInt(value, 16)));
}

function remainingMs() {
  const value = deadlineAt - Date.now();
  if (value <= 0) throw new Error('Fixture reached its 90-second deadline.');
  return value;
}

async function waitForDescriptor(descriptorPath, record) {
  const end = Math.min(deadlineAt, Date.now() + 20_000);
  while (Date.now() < end) {
    try {
      const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
      if (descriptor.version === 1 && descriptor.connected === false &&
          !Object.hasOwn(descriptor, 'token') && !Object.hasOwn(descriptor, 'endpoint') &&
          Number.isInteger(descriptor.pid) && descriptor.pid > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      const endpoint = new URL(descriptor.endpoint);
      if (descriptor.version !== 1 || endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' ||
          !/^\d+$/.test(endpoint.port) || endpoint.pathname !== '/connect' || !/^[a-f0-9]{64}$/.test(descriptor.token ?? '') ||
          !Number.isInteger(descriptor.pid) || descriptor.pid < 1)
        throw new Error('Prepared native host wrote an invalid descriptor.');
      // Do not persist or print the bearer token.
      record.nativeHostPid = descriptor.pid;
      record.steps.push({ step: 'native-host-descriptor', status: 'ready', loopback: true, tokenPresent: true });
      await saveRecord(record);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('Native host descriptor did not appear within 20 seconds; service worker/native host startup may have failed. No foreground fallback was attempted.');
}

let record;
async function saveRecord(value = record) {
  await writeFile(resultPath, JSON.stringify(value, null, 2));
}

async function foregroundSnapshot() {
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class KNativeFocusProbe {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
"@
$hwnd=[KNativeFocusProbe]::GetForegroundWindow();$ownerPid=0
if($hwnd -ne [IntPtr]::Zero){[void][KNativeFocusProbe]::GetWindowThreadProcessId($hwnd,[ref]$ownerPid)}
[Console]::Out.Write(($hwnd.ToInt64().ToString()+','+$ownerPid.ToString()))`;
  const { stdout } = await execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 3000, maxBuffer: 1024,
  });
  const match = /^(\d+),(\d+)$/.exec(stdout.trim());
  if (!match) throw new Error('Could not read foreground HWND/PID without window titles.');
  return { hwnd: match[1], pid: Number(match[2]) };
}

async function openRawCdp(profileDirectory, previousEndpoint) {
  const portFile = path.join(profileDirectory, 'DevToolsActivePort');
  const end = Math.min(deadlineAt, Date.now() + 15_000);
  let endpoint;
  while (Date.now() < end) {
    try {
      const [port, browserPath] = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/u);
      if (/^\d+$/.test(port) && /^\/devtools\/browser\/[a-zA-Z0-9_-]+$/.test(browserPath ?? '')) {
        const candidate = `ws://127.0.0.1:${port}${browserPath}`;
        if (candidate !== previousEndpoint) { endpoint = candidate; break; }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!endpoint) throw new Error('Chromium debugging endpoint did not appear; no foreground fallback was attempted.');

  const socket = new WebSocket(endpoint, { handshakeTimeout: Math.min(5000, remainingMs()) });
  await once(socket, 'open');
  let nextId = 0;
  const pending = new Map();
  socket.on('message', data => {
    let message;
    try { message = JSON.parse(data.toString()); } catch { return; }
    if (message.id === undefined) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    message.error ? request.reject(new Error(message.error.message ?? 'Chrome DevTools command failed.')) : request.resolve(message.result);
  });
  socket.on('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Chrome DevTools connection closed.'));
    }
    pending.clear();
  });
  return {
    endpoint,
    socket,
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome DevTools ${method} timed out.`)); }, Math.min(5000, remainingMs()));
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

async function waitForExtensionWorker(cdp, extensionId) {
  const end = Math.min(deadlineAt, Date.now() + 10_000);
  while (Date.now() < end) {
    const { targetInfos = [] } = await cdp.send('Target.getTargets');
    const target = targetInfos.find(info => info.type === 'service_worker' && info.url.startsWith(`chrome-extension://${extensionId}/`));
    if (target) return target;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('K extension service worker did not start. No visible-window or foreground fallback was attempted.');
}

async function attachWorker(cdp, extensionId) {
  const worker = await waitForExtensionWorker(cdp, extensionId);
  const attached = await cdp.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
  const sessionId = attached.sessionId;
  assert(sessionId, 'Chrome did not attach to the K extension service worker.');
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
  return { worker, sessionId };
}

async function waitForFreshDescriptor(descriptorPath, record, previousPid) {
  const end = Math.min(deadlineAt, Date.now() + 20_000);
  while (Date.now() < end) {
    try {
      const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
      if (descriptor.version === 1 && descriptor.connected === false &&
          !Object.hasOwn(descriptor, 'token') && !Object.hasOwn(descriptor, 'endpoint') &&
          Number.isInteger(descriptor.pid) && descriptor.pid > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      if (typeof descriptor.endpoint !== 'string' || typeof descriptor.token !== 'string') {
        throw new Error('Reloaded native host descriptor is neither active nor a valid disconnected descriptor.');
      }
      const endpoint = new URL(descriptor.endpoint);
      const validActive = descriptor.version === 1 && endpoint.protocol === 'ws:' && endpoint.hostname === '127.0.0.1' &&
        /^\d+$/.test(endpoint.port) && endpoint.pathname === '/connect' && /^[a-f0-9]{64}$/.test(descriptor.token ?? '') &&
        Number.isInteger(descriptor.pid) && descriptor.pid > 0 && descriptor.pid !== previousPid;
      if (validActive) {
        let alive = true;
        try { process.kill(descriptor.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
        if (alive) {
          record.nativeHostPid = descriptor.pid;
          record.steps.push({ step: 'native-host-descriptor-reconnected', status: 'ready', newHostProcess: true, tokenPresent: true });
          await saveRecord(record);
          return;
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Reloaded K extension did not start a new native host connection within 20 seconds. No retry or foreground fallback was attempted.');
}

async function enableIncognitoForFixture(cdp, extensionId, record) {
  // Use Chrome's own extensions settings API, scoped to this disposable
  // profile. If that API is unavailable or Chrome refuses the change, fail
  // closed; do not use hidden preferences or a different profile.
  const target = await cdp.send('Target.createTarget', { url: 'chrome://extensions/' });
  assert(target.targetId, 'Could not open Chrome extensions settings in the fixture profile.');
  try {
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    assert(attached.sessionId, 'Could not attach to the fixture extensions settings page.');
    const configured = await cdp.send('Runtime.evaluate', {
      expression: `(async()=>{const api=chrome.developerPrivate;if(!api||typeof api.updateExtensionConfiguration!=='function')return {ok:false,reason:'Chrome extensions settings API unavailable'};return await new Promise((resolve,reject)=>{let settled=false;const finish=(ok,value)=>{if(settled)return;settled=true;clearTimeout(timer);ok?resolve({ok:true}):resolve({ok:false,reason:String(value||'Chrome refused incognito permission')})};const timer=setTimeout(()=>finish(false,'Chrome settings API did not complete'),4000);try{const returned=api.updateExtensionConfiguration({extensionId:${JSON.stringify(extensionId)},incognitoAccess:true},result=>{const error=chrome.runtime.lastError;finish(!error,error?.message||result)});if(returned&&typeof returned.then==='function')returned.then(value=>finish(true,value),error=>finish(false,error?.message||error))}catch(error){finish(false,error?.message||error)}})})()`,
      awaitPromise: true,
      returnByValue: true,
    }, attached.sessionId);
    assert.equal(configured.exceptionDetails, undefined, 'Chrome extensions settings API threw while enabling fixture incognito access.');
    const configurationResult = configured.result?.value;
    assert.equal(configurationResult?.ok, true, `Chrome did not enable incognito access for the fixture extension: ${configurationResult?.reason ?? 'unknown error'}`);
    await recordStep('fixture-incognito-permission-configured', 'completed', { api: 'chrome.developerPrivate.updateExtensionConfiguration', profileOnly: true });
  } finally {
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
  }

}

async function verifyIncognitoPermission(cdp, sessionId) {
  // Verify permission using the extension's public API after Chrome restarts
  // with this same disposable profile.
  const verification = await cdp.send('Runtime.evaluate', {
    expression: 'chrome.extension.isAllowedIncognitoAccess()',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  assert.equal(verification.exceptionDetails, undefined, 'Could not read back extension incognito permission.');
  assert.equal(verification.result?.value, true, 'Chrome did not grant incognito access to the fixture extension.');
  await recordStep('fixture-incognito-permission-readback', 'verified', { allowed: true });
}

async function boundedCleanup(record, label, cleanup, timeoutMs = 4000) {
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(cleanup).then(() => 'completed', () => 'failed'),
      new Promise(resolve => { timer = setTimeout(() => resolve('timed-out'), Math.min(timeoutMs, Math.max(1, deadlineAt - Date.now()))); }),
    ]);
    record.cleanup ??= [];
    record.cleanup.push({ step: label, status: result });
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function recordStep(name, status, details = {}) {
  record.steps.push({ step: name, status, ...details });
  await saveRecord();
  console.log(`STEP ${name}: ${status}`);
}

function startForegroundSampler() {
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class KNativeFocusSampler {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
"@
while($true){$hwnd=[KNativeFocusSampler]::GetForegroundWindow();$ownerPid=0
 if($hwnd -ne [IntPtr]::Zero){[void][KNativeFocusSampler]::GetWindowThreadProcessId($hwnd,[ref]$ownerPid)}
 [Console]::Out.WriteLine(([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()+','+$hwnd.ToInt64().ToString()+','+$ownerPid.ToString()))
 [Console]::Out.Flush();Start-Sleep -Milliseconds 100
}`;
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const stream = createWriteStream(path.join(resultRoot, 'foreground-samples.csv'), { flags: 'wx' });
  stream.write('utcMs,foregroundHwnd,foregroundPid,isTestChromeProcess\n');
  let pending = '';
  let count = 0;
  let chromePidSamples = 0;
  const rootPids = new Set();
  const timestamps = [];
  let stopPromise;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    pending += chunk;
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const match = /^(\d+),(\d+),(\d+)$/.exec(line.trim());
      if (!match) continue;
      const [utcMs, hwnd, pid] = match.slice(1).map(Number);
      const isChrome = rootPids.has(pid);
      count++;
      if (isChrome) chromePidSamples++;
      timestamps.push(utcMs);
      stream.write(`${utcMs},${hwnd},${pid},${isChrome}\n`);
    }
  });
  return {
    child,
    setRootPid(pid) { rootPids.add(pid); },
    async stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('exit', resolve);
        setTimeout(resolve, 1500);
      });
      stream.end();
      await new Promise(resolve => stream.once('finish', resolve));
      const maxGapMs = timestamps.length > 1 ? Math.max(...timestamps.slice(1).map((time, index) => time - timestamps[index])) : null;
      return { samples: count, testChromeForegroundSamples: chromePidSamples, maxGapMs };
      })();
      return stopPromise;
    },
  };
}

async function waitForChromeExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise(resolve => {
    let timer;
    const finish = exited => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    child.once('exit', onExit);
    timer = setTimeout(() => finish(child.exitCode !== null || child.signalCode !== null), timeoutMs);
  });
}

async function launchFixtureChrome(profileDirectory, sampler, record, stage) {
  const child = spawn(chromiumPath, [
    `--user-data-dir=${profileDirectory}`,
    '--headless=new',
    '--no-startup-window',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ], { windowsHide: true, detached: false, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chromium ${stage} did not start within 15 seconds; no foreground fallback was attempted.`)), Math.min(15_000, remainingMs()));
    child.once('spawn', () => { clearTimeout(timer); resolve(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  sampler.setRootPid(child.pid);
  record.chromeRootPids ??= [];
  record.chromeRootPids.push(child.pid);
  await recordStep(`chromium-start-${stage}`, 'spawned', { headless: 'new', noStartupWindow: true, loadedExtension: true, remoteDebuggingPort: 'random', pid: child.pid });
  return child;
}

async function waitForPidExit(pid, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
}

async function verifyDisconnectedDescriptor(descriptorPath) {
  const end = Date.now() + 5000;
  let lastDescriptor;
  while (Date.now() < end) {
    try {
      const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
      lastDescriptor = descriptor;
      if (descriptor.version === 1 && descriptor.connected === false &&
          !Object.hasOwn(descriptor, 'token') && !Object.hasOwn(descriptor, 'endpoint') &&
          Number.isInteger(descriptor.pid) && descriptor.pid > 0) {
        const exited = await waitForPidExit(descriptor.pid, Math.min(500, Math.max(100, end - Date.now())));
        if (exited) return { connected: false, tokenPresent: false, endpointPresent: false, hostPidExited: true };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // The host contract keeps a non-secret disconnected descriptor; absence
      // is not accepted as proof that the host released its connection.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Native host did not reach disconnected state with an exited host PID; last descriptor state: ${JSON.stringify({connected:lastDescriptor?.connected, tokenPresent:Object.hasOwn(lastDescriptor ?? {}, 'token'), endpointPresent:Object.hasOwn(lastDescriptor ?? {}, 'endpoint'), pid:lastDescriptor?.pid})}`);
}

async function rpc(config, method, params = {}) {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { ...config.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc.sequence, method, params }),
    signal: AbortSignal.timeout(Math.min(20_000, remainingMs())),
  });
  const body = await response.text();
  assert.equal(response.status, 200, `MCP ${method} returned HTTP ${response.status}.`);
  const payload = body.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5)).join('\n') || body;
  const message = JSON.parse(payload);
  assert(!message.error, `MCP ${method} failed: ${JSON.stringify(message.error)}`);
  return message.result;
}
rpc.sequence = 0;

async function main() {
  const preparedRoot = parsePreparedRoot(process.argv.slice(2));
  const configPath = path.join(preparedRoot, 'host', 'config.json');
  const descriptorPath = path.join(preparedRoot, 'native-link.json');
  const manifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
  const extensionId = extensionIdFromManifest(manifest);
  const config = validateHostConfig(JSON.parse(await readFile(configPath, 'utf8')));

  assert.equal(manifest.version, '0.1.2', 'Load the native-messaging extension build 0.1.2.');
  assert(manifest.permissions.includes('nativeMessaging'), 'Built extension must request nativeMessaging.');
  assert.equal(extensionId, K_EXTENSION_ID, 'Built extension key must match this K-only native host.');
  assert.equal(config.extensionId, extensionId);
  assert.equal(config.descriptorPath, descriptorPath, 'Prepared host descriptor must be root/native-link.json.');
  const runDirectory = path.relative(runtimeRoot, preparedRoot);
  assert(runDirectory && !runDirectory.startsWith('..') && !path.isAbsolute(runDirectory),
    'Prepared root must be inside .runtime/browser-native-connection.');
  assert(/^\d{8}-\d{6}$/u.test(runDirectory), 'Prepared root must be the timestamped fixture directory selected by the parent.');
  assert.equal(config.profileDirectory, path.join(preparedRoot, 'chrome-profile'),
    'Use the Chrome profile already prepared by the parent; do not select another profile.');
  await access(chromiumPath);
  const profileInfo = await lstat(config.profileDirectory).then(info => info, error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (profileInfo) {
    assert(profileInfo.isDirectory() && !profileInfo.isSymbolicLink(), 'Prepared Chrome profile must be a real directory.');
    assert.equal((await readdir(config.profileDirectory)).length, 0, 'Refusing to reuse a non-empty Chrome profile.');
  }
  await lstat(descriptorPath).then(() => { throw new Error('Refusing to reuse an existing native-link descriptor.'); }, error => {
    if (error.code !== 'ENOENT') throw error;
  });

  resultRoot = path.join(preparedRoot, 'probe-evidence');
  await mkdir(resultRoot);
  resultPath = path.join(resultRoot, 'result.json');
  record = {
    scope: 'headless=new fake fixtures/existing windows only; disposable Chromium profile; localhost fake page; no existing Chrome profile or login data; not a headed no-focus acceptance',
    chromeLaunchMode: 'headless=new',
    profileDirectory: config.profileDirectory,
    extensionId,
    chromeExecutable: chromiumPath,
    steps: [],
    status: 'running',
  };
  await saveRecord();

  const fakeServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><meta charset="utf-8"><title>K Native Fake Page</title><h1>Fake Page</h1><input id="value"><button id="submit" onclick="document.querySelector(\'output\').textContent=document.querySelector(\'#value\').value">Submit</button><output></output>');
  });
  let chromeProcess;
  let gateway;
  const externalContexts = new Map();
  let cdp;
  let foregroundSampler;
  let workerSessionId;
  let fixtureOrigin;
  const beforeChrome = await foregroundSnapshot();
  record.foregroundSnapshots = [{ stage: 'before-chromium', ...beforeChrome }];
  await saveRecord();
  try {
    await new Promise((resolve, reject) => {
      fakeServer.once('error', reject);
      fakeServer.listen(0, '127.0.0.1', resolve);
    });
    fixtureOrigin = `http://127.0.0.1:${fakeServer.address().port}`;
    record.steps.push({ step: 'localhost-fake-page', status: 'ready' });
    await saveRecord();

    foregroundSampler = startForegroundSampler();
    let samplerTimer;
    try {
      await Promise.race([
        once(foregroundSampler.child, 'spawn'),
        new Promise((_, reject) => { samplerTimer = setTimeout(() => reject(new Error('OS foreground monitor failed to start.')), Math.min(3000, remainingMs())); }),
      ]);
    } finally { clearTimeout(samplerTimer); }
    await recordStep('os-foreground-monitor', 'started', { intervalMs: 100, fields: ['HWND', 'PID'], windowTitlesRead: false });

    chromeProcess = await launchFixtureChrome(config.profileDirectory, foregroundSampler, record, 'initial');

    cdp = await openRawCdp(config.profileDirectory);
    // Attach Chrome DevTools before waiting for the native host descriptor so
    // a host startup failure still leaves us able to close this fixture.
    await waitForDescriptor(descriptorPath, record);
    await recordStep('extension-native-host-start', 'connected');
    const worker = await waitForExtensionWorker(cdp, extensionId);
    await recordStep('extension-service-worker-discovered', 'ready', { targetType: worker.type });
    ({ sessionId: workerSessionId } = await attachWorker(cdp, extensionId));
    await recordStep('service-worker-runtime-enabled', 'ready');
    await recordStep('service-worker-resumed-if-waiting', 'ready');
    const bootstrap = await cdp.send('Runtime.evaluate', {
      expression: "chrome.windows.create({url:'about:blank',focused:false,state:'minimized',incognito:false}).then(w=>({id:w.id,state:w.state,focused:w.focused})).catch(e=>({error:String(e)}))",
      awaitPromise: true,
      returnByValue: true,
    }, workerSessionId);
    const bootstrapState = bootstrap.result?.value;
    assert.equal(bootstrap.exceptionDetails, undefined, 'K extension worker could not create its minimized fixture window.');
    assert(Number.isInteger(bootstrapState?.id), 'K extension worker did not return a bootstrap window ID.');
    await recordStep('minimized-window-bootstrap-readback', 'recorded', {
      requestedState: 'minimized', returnedState: bootstrapState.state, returnedFocused: bootstrapState.focused,
    });
    let foreground = await foregroundSnapshot();
    record.foregroundSnapshots.push({ stage: 'after-minimized-bootstrap', ...foreground, chromeRootForeground: foreground.pid === chromeProcess.pid });
    assert.notEqual(foreground.pid, chromeProcess.pid, 'The fixture Chrome root process became the OS foreground process.');
    await saveRecord();

    const previousNativeHostPid = record.nativeHostPid;
    await enableIncognitoForFixture(cdp, extensionId, record);
    await recordStep('chromium-restart-for-extension-worker', 'started', { sameDisposableProfile: true });
    await cdp.send('Browser.close');
    const firstChromePid = chromeProcess.pid;
    const firstChromeExited = await waitForChromeExit(chromeProcess, 5000);
    assert(firstChromeExited, 'Fixture Chromium did not close before the same-profile restart.');
    record.chromeRestarts ??= [];
    record.chromeRestarts.push({ pid: firstChromePid, exited: true });
    await verifyDisconnectedDescriptor(descriptorPath);
    if (cdp.socket.readyState === WebSocket.OPEN) {
      const socketClosed = once(cdp.socket, 'close');
      cdp.socket.close();
      await socketClosed;
    }
    const previousDebugEndpoint = cdp.endpoint;
    cdp = undefined;
    chromeProcess = await launchFixtureChrome(config.profileDirectory, foregroundSampler, record, 'same-profile-restart');
    cdp = await openRawCdp(config.profileDirectory, previousDebugEndpoint);
    await waitForFreshDescriptor(descriptorPath, record, previousNativeHostPid);
    const latestWorker = await attachWorker(cdp, extensionId);
    workerSessionId = latestWorker.sessionId;
    const restartBootstrap = await cdp.send('Runtime.evaluate', {
      expression: "Promise.all([chrome.windows.create({url:'about:blank',focused:false,state:'minimized',incognito:false}),chrome.windows.create({url:'about:blank',focused:false,state:'minimized',incognito:true})]).then(([regular,incognito])=>({regular:{id:regular.id,state:regular.state,focused:regular.focused,incognito:regular.incognito},incognito:{id:incognito.id,state:incognito.state,focused:incognito.focused,incognito:incognito.incognito}})).catch(e=>({error:String(e)}))",
      awaitPromise: true,
      returnByValue: true,
    }, workerSessionId);
    const restartBootstrapState = restartBootstrap.result?.value;
    assert.equal(restartBootstrap.exceptionDetails, undefined, 'K extension worker could not prepare regular and incognito windows after same-profile Chrome restart.');
    assert(Number.isInteger(restartBootstrapState?.regular?.id), 'Restarted K extension worker did not return a regular bootstrap window ID.');
    assert(Number.isInteger(restartBootstrapState?.incognito?.id), 'Restarted K extension worker did not return an incognito bootstrap window ID.');
    assert.equal(restartBootstrapState.incognito.incognito, true, 'The prepared incognito window is not actually incognito.');
    await recordStep('same-profile-restart-window-bootstrap', 'recorded', {
      requestedState: 'minimized', regular: restartBootstrapState.regular, incognito: restartBootstrapState.incognito,
      purpose: 'simulate matching-mode windows already open before K browser work',
    });
    foreground = await foregroundSnapshot();
    record.foregroundSnapshots.push({ stage: 'after-same-profile-restart-bootstrap', ...foreground, chromeRootForeground: foreground.pid === chromeProcess.pid });
    assert.notEqual(foreground.pid, chromeProcess.pid, 'The restarted fixture Chrome root process became the OS foreground process.');
    await saveRecord();
    await verifyIncognitoPermission(cdp, workerSessionId);

    for (const name of ['output', 'gateway-profile']) await mkdir(path.join(resultRoot, name), { recursive: true });
    gateway = await createExternalBrowserGateway({
      directory: path.join(resultRoot, 'output'),
      profile: path.join(resultRoot, 'gateway-profile'),
      launchExternalContext: async ({ mode }) => {
        assert(['regular', 'incognito'].includes(mode), `Unexpected gateway browser mode ${String(mode)}.`);
        if (externalContexts.has(mode)) return externalContexts.get(mode);
        const context = await createChromeExtensionContext({
          mode,
          extensionId,
          timeoutMs: Math.min(20_000, remainingMs()),
          openConnectPage: url => openChromeConnectPageViaNative({ descriptorPath, timeoutMs: Math.min(12_000, remainingMs()) }, url),
        });
        externalContexts.set(mode, context);
        return context;
      },
    });
    const mcp = gateway.aiMcpServer;
    await rpc(mcp, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'K native browser fixture', version: '1' } });
    await recordStep('mcp-initialize', 'completed');
    await rpc(mcp, 'tools/list');
    await recordStep('mcp-tools-list', 'completed');

    const call = async (name, args = {}) => {
      await recordStep(`mcp-tool-${name}`, 'started');
      const result = await rpc(mcp, 'tools/call', { name, arguments: args });
      assert(!result?.isError, `MCP tool ${name} failed: ${JSON.stringify(result)}`);
      await recordStep(`mcp-tool-${name}`, 'completed');
      return result;
    };
    for (const mode of ['regular', 'incognito']) {
      await call('browser_session', { mode });
      await recordStep(`native-connect-${mode}`, 'connected', { pathway: 'openChromeConnectPageViaNative -> createChromeExtensionContext' });
      await call('browser_navigate', { url: fixtureOrigin });
      await call('browser_type', { target: '#value', text: `NATIVE_FAKE_${mode.toUpperCase()}_OK` });
      await call('browser_click', { target: '#submit' });
      const result = await call('browser_evaluate', { function: '() => ({title:document.title,value:document.querySelector("output").textContent})' });
      assert.match(JSON.stringify(result), new RegExp(`NATIVE_FAKE_${mode.toUpperCase()}_OK`, 'u'));
      assert.match(JSON.stringify(result), /K Native Fake Page/u);
      const screenshot = await call('browser_take_screenshot');
      const image = screenshot.content?.find(item => item.type === 'image');
      assert(image?.data, `MCP screenshot did not return image data in ${mode} mode.`);
      await writeFile(path.join(resultRoot, `fake-page-${mode}.png`), Buffer.from(image.data, 'base64'));

      const focusResult = await cdp.send('Runtime.evaluate', {
        expression: `chrome.tabs.query({url:${JSON.stringify(`${fixtureOrigin}/*`)}}).then(async tabs=>{const matching=tabs.filter(tab=>tab.incognito===${mode === 'incognito'});const windows=await chrome.windows.getAll({populate:false});const ids=[...new Set(matching.map(tab=>tab.windowId))];return {fakeTabCount:matching.length,fakeWindows:windows.filter(win=>ids.includes(win.id)).map(win=>({focused:win.focused}))}})`,
        awaitPromise: true,
        returnByValue: true,
      }, workerSessionId);
      const focusState = focusResult.result?.value;
      assert.equal(focusResult.exceptionDetails, undefined, `Could not read Chrome window state in ${mode} mode.`);
      assert(focusState.fakeTabCount > 0, `The fake page is not present in the extension-owned ${mode} context.`);
      assert(focusState.fakeWindows.length > 0, `Could not read the fake page Chrome window state in ${mode} mode.`);
      foreground = await foregroundSnapshot();
      record.foregroundSnapshots.push({ stage: `after-fake-browser-work-${mode}`, ...foreground, chromeRootForeground: foreground.pid === chromeProcess.pid });
      assert.notEqual(foreground.pid, chromeProcess.pid, `The fixture Chrome root process became the OS foreground process during ${mode} fake work.`);
      record.focusCheck ??= {};
      record.focusCheck[mode] = { chromeApiWindowInfo: focusState.fakeWindows, fakeTabCount: focusState.fakeTabCount };
      await recordStep(`chrome-api-focus-readback-${mode}`, 'recorded', record.focusCheck[mode]);
      await recordStep(`fake-page-input-click-evaluate-screenshot-${mode}`, 'passed');
      const context = externalContexts.get(mode);
      const original = context.pages()[0], originalUrl = original.url();
      for (const encoding of ['percent', 'base64']) {
        const html = '<!doctype html><meta charset="utf-8"><title>K data regression</title><input id="value"><button id="submit" onclick="document.querySelector(\'output\').textContent=document.querySelector(\'#value\').value">OK</button><output></output>';
        const url = encoding === 'percent' ? 'data:text/html;charset=utf-8,' + encodeURIComponent(html) : 'data:text/html;charset=utf-8;base64,' + Buffer.from(html).toString('base64');
        await call('browser_navigate', {url});
        const page = context.pages().at(-1);
        assert.equal(page.url(), url);
        assert.equal(await page.evaluate(() => self.origin), 'null');
        assert.equal(original.url(), originalUrl);
        await call('browser_type', {target:'#value', text:'DATA_OK'});
        await call('browser_click', {target:'#submit'});
        const readback = await call('browser_evaluate', {function:'() => document.querySelector("output").textContent'});
        assert.match(JSON.stringify(readback), /DATA_OK/);
        const shot = await call('browser_take_screenshot');
        const dataImage = shot.content.find(item => item.type === 'image');
        assert(dataImage?.data);
        await writeFile(path.join(resultRoot, `data-${mode}-${encoding}.png`), Buffer.from(dataImage.data,'base64'));
        await page.reload({waitUntil:'domcontentloaded',timeout:5000});
        assert.equal(page.url(),url);
        await recordStep(`data-${mode}-${encoding}`, 'passed', {opaqueOrigin:true, originalPreserved:true, inputClickScreenshotReload:true});
      }
    }
    const samplerSummary = await foregroundSampler.stop();
    foregroundSampler = undefined;
    record.foregroundSampler = samplerSummary;
    record.foregroundMonitorInterpretation = 'Headless-only measurement; it does not establish headed Chrome no-focus acceptance.';
    assert(samplerSummary.samples > 0, 'OS foreground monitor produced no HWND/PID samples.');
    assert.equal(samplerSummary.testChromeForegroundSamples, 0, 'OS foreground monitor observed the fixture Chrome root PID in the foreground.');
    await recordStep('os-foreground-check', 'recorded', { ...samplerSummary, titlesRead: false, interpretation: 'headless-only; not headed no-focus acceptance' });
    record.status = 'passed';
    await saveRecord();
  } catch (error) {
    record.status = 'failed';
    record.error = error.stack ?? error.message;
    if (String(error.message).includes('service worker'))
      record.failureNote = 'No attempt was made to open or focus a Chrome window as fallback.';
    await saveRecord();
    throw error;
  } finally {
    // Browser.close gives Chromium/native messaging a graceful EOF first.
    if (cdp) await boundedCleanup(record, 'Browser.close', () => cdp.send('Browser.close'));
    if (chromeProcess) {
      let exited = false;
      await boundedCleanup(record, 'Chrome-graceful-exit-wait', async () => { exited = await waitForChromeExit(chromeProcess, 5000); }, 5500);
      if (!exited && chromeProcess.exitCode === null && chromeProcess.signalCode === null) {
        await boundedCleanup(record, 'owned-Chrome-process-tree', () => execFile(
          path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/PID', String(chromeProcess.pid), '/T', '/F'],
          { windowsHide: true, timeout: 4000, maxBuffer: 1024 },
        ));
        await boundedCleanup(record, 'Chrome-exit-after-targeted-stop', async () => { exited = await waitForChromeExit(chromeProcess, 1500); });
      }
      record.chromeExit = { exited, exitCode: chromeProcess.exitCode, signalCode: chromeProcess.signalCode };
    }
    if (gateway) await boundedCleanup(record, 'gateway.close', () => gateway.close());
    for (const [mode, context] of externalContexts)
      await boundedCleanup(record, `extension-context-close-${mode}`, () => context.close());
    if (cdp?.socket.readyState === WebSocket.OPEN)
      await boundedCleanup(record, 'raw-CDP-close', () => new Promise(resolve => { cdp.socket.once('close', resolve); cdp.socket.close(); }));
    if (fakeServer.listening)
      await boundedCleanup(record, 'fake-server.close', () => new Promise(resolve => fakeServer.close(resolve)));
    if (foregroundSampler) {
      const summary = await boundedCleanup(record, 'foreground-sampler.stop', async () => { record.foregroundSampler = await foregroundSampler.stop(); });
      if (summary !== 'completed') record.foregroundSamplerCleanup = summary;
    }
    if (record && descriptorPath) {
      const disconnected = await boundedCleanup(record, 'native-host-disconnected-descriptor-readback', async () => {
        const proof = await verifyDisconnectedDescriptor(descriptorPath);
        record.nativeHostCleanup = proof;
      }, 6000);
      if (disconnected !== 'completed') record.nativeHostCleanup = { status: disconnected };
    }
    if (record && record.status !== 'passed' && record.status !== 'failed') record.status = 'incomplete';
    if (record?.status === 'passed' && ((record.cleanup ?? []).some(item => item.status !== 'completed') || record.chromeExit?.exited === false)) {
      record.status = 'failed';
      record.error = 'One or more required cleanup steps did not complete, or fixture Chrome did not exit; this fixture cannot be reported as passed.';
    }
    if (record) await saveRecord();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().then(() => {
    console.log(JSON.stringify({ status: record.status, steps: record.steps, result: resultPath }, null, 2));
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
