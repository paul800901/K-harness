import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';

const capture = promisify(execFile);

// No provider keys, owner HOME, Node injection options, browser capabilities or
// unrelated application environment are inherited by the untrusted runtime.
export function isolatedAgentEnvironment({home, source = process.env} = {}) {
  if (!path.isAbsolute(home ?? '')) throw new Error('An absolute isolated home is required.');
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) {
    const key = Object.keys(source).find(key => key.toUpperCase() === name.toUpperCase());
    if (key && typeof source[key] === 'string') env[name] = source[key];
  }
  return {...env, HOME:home, USERPROFILE:home, APPDATA:path.join(home,'AppData','Roaming'),
    LOCALAPPDATA:path.join(home,'AppData','Local'), TEMP:path.join(home,'tmp'), TMP:path.join(home,'tmp'),
    CODEX_HOME:path.join(home,'.codex'), CLAUDE_CONFIG_DIR:path.join(home,'.claude')};
}

// Start.exe is a GUI application, but /listpids has a documented stdout
// protocol: count followed by exactly that many process IDs. A successful
// /terminate exit alone is not evidence that the box has finished shutting down.
export function parseSandboxiePids(output) {
  const lines = String(output).trim().split(/\r?\n/);
  if (!lines.every(line => /^(?:0|[1-9][0-9]*)$/.test(line))) throw new Error('Invalid Sandboxie process readback.');
  const [count,...pids] = lines.map(Number);
  if (!Number.isSafeInteger(count) || count !== pids.length || !pids.every(pid => Number.isSafeInteger(pid) && pid > 0) || new Set(pids).size !== pids.length) {
    throw new Error('Incomplete Sandboxie process readback.');
  }
  return pids;
}

export function createSandboxieBoxControl({startExe, boxName, captureImpl = capture, env = process.env,
  timeoutMs = 10000, pollMs = 100} = {}) {
  if (!path.isAbsolute(startExe ?? '') || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(boxName ?? '') || boxName.toLowerCase() === 'defaultbox') {
    throw new Error('An explicit dedicated Sandboxie box and absolute Start.exe are required.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(pollMs) || pollMs < 1) throw new Error('Invalid Sandboxie shutdown deadline.');
  const command = async action => captureImpl(startExe,[`/box:${boxName}`, action],
    {windowsHide:true, shell:false, encoding:'utf8', timeout:timeoutMs, maxBuffer:65536, env});
  async function pids() { return parseSandboxiePids((await command('/listpids')).stdout); }
  async function assertIdle() {
    if ((await pids()).length) throw new Error('This isolated box still has active work.');
  }
  async function stopBox() {
    await command('/terminate');
    const end = Date.now() + timeoutMs;
    do {
      if (!(await pids()).length) return {confirmed:true};
      if (Date.now() >= end) break;
      await new Promise(resolve => setTimeout(resolve, pollMs));
    } while (true);
    throw new Error('Sandboxie shutdown is not confirmed; box remains reserved.');
  }
  return {pids, assertIdle, stopBox};
}
