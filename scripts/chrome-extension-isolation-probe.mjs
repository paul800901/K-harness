// Fake-data-only probe of the isolated browser boundary. It never targets or
// stops an occupied Sandboxie box and never opens a real browser profile.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createSandboxieSpawn} from '../src/sandboxie-process.mjs';
import {createSandboxieBoxControl, isolatedAgentEnvironment} from '../src/sandboxie-control.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(root, '.runtime', 'isolation-pilot', 'sandboxie-candidate-3b6c43ee');
const boxName = 'KCandidate8';
const startExe = path.join(runtimeRoot, 'portable', 'Start.exe');
const bridgePath = path.join(root, 'src', 'sandboxie-stdio-bridge.mjs');
const psExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const chromiumPath = path.join(root, '.runtime', 'playwright-browsers', 'chromium-1246', 'chrome-win64', 'chrome.exe');
const id = `${Date.now()}-${process.pid}`;
const evidenceRoot = path.join(root, '.runtime', 'k-browser-assistant-20260927', `chrome-isolation-${id}`);
const workspaceRoot = path.join(runtimeRoot, 'workspace', `chrome-isolation-${id}`);
const vaultRoot = path.join(runtimeRoot, 'vault', `chrome-isolation-${id}`);
const profileRoot = path.join(vaultRoot, 'empty-chrome-profile');
const fakeVaultFile = path.join(profileRoot, 'K_FAKE_VAULT_MARKER.txt');
const candidateResultPath = path.join(workspaceRoot, 'candidate-result.json');
const resultPath = path.join(evidenceRoot, 'result.json');
const fakeMarker = `FAKE_ONLY_CHROME_PROFILE_${id}`;
const env = isolatedAgentEnvironment({home: path.join(evidenceRoot, 'isolated-home')});
const control = createSandboxieBoxControl({startExe, boxName, env, timeoutMs: 15000});
let browserContext;
let sandboxChild;
let candidateStdout = '';
let candidateStderr = '';
const record = {
  started: new Date().toISOString(),
  status: 'running',
  boxName,
  scope: 'fake data only; fresh empty Chromium profile; no extension, credentials, policy/ACL changes, or formal K stop',
  paths: {evidenceRoot, workspaceRoot, vaultRoot, profileRoot, fakeVaultFile},
};

async function save() {
  await fs.mkdir(evidenceRoot, {recursive: true});
  await fs.writeFile(resultPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

function allBoxPids() {
  const result = {};
  for (let index = 1; index <= 8; index += 1) {
    const name = `KCandidate${index}`;
    const output = execFileSync(startExe, [`/box:${name}`, '/listpids'], {
      cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 15000,
    });
    const lines = output.trim().split(/\r?\n/);
    assert.ok(lines.length >= 1 && lines.every(line => /^(?:0|[1-9][0-9]*)$/.test(line)), `Invalid ${name} PID readback`);
    const [count, ...pids] = lines.map(Number);
    assert.equal(count, pids.length, `Incomplete ${name} PID readback`);
    result[name] = pids;
  }
  return result;
}

function readBoxPids(name) {
  const output = execFileSync(startExe, [`/box:${name}`, '/listpids'], {
    cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 15000,
  });
  const lines = output.trim().split(/\r?\n/);
  assert.ok(lines.length >= 1 && lines.every(line => /^(?:0|[1-9][0-9]*)$/.test(line)), `Invalid ${name} PID readback`);
  const [count, ...pids] = lines.map(Number);
  assert.equal(count, pids.length, `Incomplete ${name} PID readback`);
  return pids;
}

function trustedTargetScript(targets) {
  const targetB64 = Buffer.from(JSON.stringify(targets), 'utf8').toString('base64');
  return `$ErrorActionPreference='Stop'\n` +
`Add-Type -TypeDefinition @'\nusing System;using System.Runtime.InteropServices;public static class KChromeProbeNative{[DllImport("kernel32.dll",SetLastError=true)]public static extern IntPtr OpenProcess(uint a,bool i,uint p);[DllImport("kernel32.dll",SetLastError=true)]public static extern bool ReadProcessMemory(IntPtr p,IntPtr a,byte[] b,IntPtr n,out UIntPtr r);[DllImport("kernel32.dll")]public static extern bool CloseHandle(IntPtr h);}\n'@\n` +
`$targets=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${targetB64}'))|ConvertFrom-Json;$out=@();foreach($t in $targets){$p=[Diagnostics.Process]::GetProcessById([int]$t.pid);$m=$p.MainModule;$buf=New-Object byte[] 2;$h=[KChromeProbeNative]::OpenProcess(0x1010,$false,[uint32]$t.pid);if($h -eq [IntPtr]::Zero){throw ('Trusted positive-control OpenProcess failed for '+$t.role)};try{$n=[UIntPtr]::Zero;$ok=[KChromeProbeNative]::ReadProcessMemory($h,$m.BaseAddress,$buf,[IntPtr]2,[ref]$n);if(!$ok -or $n.ToUInt64() -ne 2 -or $buf[0] -ne 0x4d -or $buf[1] -ne 0x5a){throw ('Trusted positive-control MZ read failed for '+$t.role)};$out+=,[ordered]@{pid=[int]$t.pid;role=$t.role;image=$m.FileName;moduleBase=$m.BaseAddress.ToInt64();bytesRead=$n.ToUInt64();mz=[Text.Encoding]::ASCII.GetString($buf)}}finally{[KChromeProbeNative]::CloseHandle($h)|Out-Null}};$out|ConvertTo-Json -Compress\n`;
}

function candidateMemoryScript(ownerEvidence) {
  const encodedTargets = Buffer.from(JSON.stringify(ownerEvidence), 'utf8').toString('base64');
  return `$ErrorActionPreference='Stop'\n` +
`Add-Type -TypeDefinition @'\nusing System;using System.Runtime.InteropServices;public static class KChromeProbeNative{[DllImport("kernel32.dll",SetLastError=true)]public static extern IntPtr OpenProcess(uint a,bool i,uint p);[DllImport("kernel32.dll",SetLastError=true)]public static extern bool ReadProcessMemory(IntPtr p,IntPtr a,byte[] b,IntPtr n,out UIntPtr r);[DllImport("kernel32.dll")]public static extern bool CloseHandle(IntPtr h);[DllImport("ntdll.dll")]public static extern int NtReadVirtualMemory(IntPtr p,IntPtr a,byte[] b,IntPtr n,out UIntPtr r);[DllImport("ntdll.dll")]public static extern int NtQueryObject(IntPtr h,int c,IntPtr b,int n,out int r);public static uint Granted(IntPtr h){IntPtr b=System.Runtime.InteropServices.Marshal.AllocHGlobal(56);try{int n;int s=NtQueryObject(h,0,b,56,out n);if(s<0)throw new Exception("NtQueryObject status=0x"+s.ToString("X8"));return unchecked((uint)System.Runtime.InteropServices.Marshal.ReadInt32(b,4));}finally{System.Runtime.InteropServices.Marshal.FreeHGlobal(b);}}}\n'@\n` +
`$targets=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedTargets}'))|ConvertFrom-Json;$out=@();foreach($t in $targets){$entry=[ordered]@{pid=[int]$t.pid;role=$t.role;vmRead=$null};$h=[KChromeProbeNative]::OpenProcess(0x1010,$false,[uint32]$t.pid);$err=[Runtime.InteropServices.Marshal]::GetLastWin32Error();if($h -eq [IntPtr]::Zero){$entry.vmRead=[ordered]@{openDenied=$true;error=$err;readAttempted=$false}}else{try{$ga=[KChromeProbeNative]::Granted($h);$buf=New-Object byte[] 2;$got=[UIntPtr]::Zero;$ok=[KChromeProbeNative]::ReadProcessMemory($h,[IntPtr]([long]$t.moduleBase),$buf,[IntPtr]2,[ref]$got);$rpmErr=[Runtime.InteropServices.Marshal]::GetLastWin32Error();$ntbuf=New-Object byte[] 2;$ntgot=[UIntPtr]::Zero;$nt=[KChromeProbeNative]::NtReadVirtualMemory($h,[IntPtr]([long]$t.moduleBase),$ntbuf,[IntPtr]2,[ref]$ntgot);$entry.vmRead=[ordered]@{openDenied=$false;grantedAccess=('0x{0:X8}' -f $ga);vmReadGranted=(($ga -band 0x10) -ne 0);rpmSucceeded=$ok;rpmBytes=$got.ToUInt64();rpmError=$rpmErr;ntStatus=('0x{0:X8}' -f $nt);ntBytes=$ntgot.ToUInt64()}}finally{[KChromeProbeNative]::CloseHandle($h)|Out-Null}};$out+=,$entry};$out|ConvertTo-Json -Depth 5 -Compress\n`;
}

try {
  // Read every box for evidence, but only KCandidate8 is this probe's target.
  record.boxReadbackBefore = allBoxPids();
  assert.deepEqual(record.boxReadbackBefore[boxName], [], `${boxName} is occupied; refusing to launch anything in it.`);
  await control.assertIdle();

  await fs.mkdir(evidenceRoot, {recursive: true});
  await fs.mkdir(workspaceRoot, {recursive: true});
  await fs.mkdir(profileRoot, {recursive: true});
  await fs.mkdir(path.dirname(env.HOME), {recursive: true});
  for (const directory of [env.APPDATA, env.LOCALAPPDATA, env.TEMP, env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) {
    await fs.mkdir(directory, {recursive: true});
  }
  await fs.writeFile(fakeVaultFile, fakeMarker, 'utf8');

  assert.ok(path.isAbsolute(chromiumPath), 'The configured installed Chromium path is not absolute.');
  await fs.access(chromiumPath);
  record.chromium = {executablePath: chromiumPath, profilePath: profileRoot, freshProfile: true, extensionLoaded: false};
  browserContext = await chromium.launchPersistentContext(profileRoot, {
    executablePath: chromiumPath,
    headless: true,
    timeout: 30000,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions'],
  });
  const page = browserContext.pages()[0];
  assert.ok(page, 'Fresh Chromium did not provide its initial blank page.');
  assert.equal(page.url(), 'about:blank', 'Fresh Chromium unexpectedly navigated away from about:blank.');
  record.chromium.initialPage = page.url();
  const browser = browserContext.browser();
  assert.ok(browser, 'Could not read back the persistent context browser handle.');
  const cdp = await browser.newBrowserCDPSession();
  let chromePid;
  try {
    const processInfo = await cdp.send('SystemInfo.getProcessInfo');
    const browserProcess = processInfo.processInfo?.find(item => item.type === 'browser');
    assert.ok(Number.isInteger(browserProcess?.id) && browserProcess.id > 0, 'Could not read back Chromium browser PID through CDP.');
    chromePid = browserProcess.id;
    record.chromium.pid = chromePid;
    record.chromium.processReadback = {source: 'CDP SystemInfo.getProcessInfo', type: browserProcess.type};
  } finally {
    await cdp.detach();
  }

  const targets = [
    {pid: process.pid, role: 'trusted-probe-node'},
    {pid: chromePid, role: 'fake-chromium-main'},
  ];
  const hostPsFile = path.join(evidenceRoot, 'trusted-positive-control.ps1');
  await fs.writeFile(hostPsFile, trustedTargetScript(targets), 'utf8');
  const hostOutput = execFileSync(psExe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hostPsFile], {
    cwd: root, env: process.env, windowsHide: true, encoding: 'utf8', timeout: 15000,
  });
  const ownerEvidence = JSON.parse(hostOutput.trim());
  assert.equal(ownerEvidence.length, 2);
  assert.ok(ownerEvidence.every(target => target.bytesRead === 2 && target.mz === 'MZ'), 'Trusted process-memory positive control did not pass.');
  record.trustedPositiveControl = ownerEvidence;

  const probePsFile = path.join(workspaceRoot, 'chrome-memory-probe.ps1');
  await fs.writeFile(probePsFile, candidateMemoryScript(ownerEvidence), 'utf8');
  const candidateCode = `(async()=>{const fs=require('node:fs');const {spawnSync}=require('node:child_process');const ps=${JSON.stringify(psExe)};const probe=${JSON.stringify(probePsFile)};const r=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',probe],{encoding:'utf8',windowsHide:true,timeout:30000});if(r.error||r.status!==0)throw new Error('Boxed PowerShell memory probe failed: '+(r.error?.message||r.stderr));const memory=JSON.parse(r.stdout.trim().split(/\\r?\\n/).at(-1));let vault;try{fs.readFileSync(${JSON.stringify(fakeVaultFile)},'utf8');vault={denied:false};}catch(e){vault={denied:['EACCES','EPERM'].includes(e.code),code:e.code};}const out={status:'candidate-complete',pid:process.pid,vault,memory,powershellStderr:r.stderr};fs.writeFileSync(${JSON.stringify(candidateResultPath)},JSON.stringify(out,null,2));process.stdout.write(JSON.stringify(out)+'\\n');await new Promise(resolve=>setTimeout(resolve,8000));})().catch(e=>{console.error(e.stack||e);process.exitCode=1});`;
  const spawnImpl = createSandboxieSpawn({boxName, startExe, nodeExecutable: process.execPath, bridgePath,
    stopBox: control.stopBox, launcherEnv: env});
  sandboxChild = spawnImpl(process.execPath, ['-e', candidateCode], {cwd: workspaceRoot, env});
  const outputPromise = new Promise((resolve, reject) => {
    let output = '';
    sandboxChild.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      candidateStdout += chunk.toString('utf8');
      const line = output.trim().split(/\r?\n/).at(-1);
      try { if (line.startsWith('{')) resolve(JSON.parse(line)); } catch {}
    });
    sandboxChild.stderr.on('data', chunk => { candidateStderr += chunk.toString('utf8'); });
    sandboxChild.once('error', reject);
    sandboxChild.once('close', (code, signal) => {
      if (code !== 0) reject(new Error(`Boxed probe exited ${code ?? signal}: ${candidateStderr.slice(-1500)}`));
    });
  });
  let candidate;
  let deadline;
  try {
    candidate = await Promise.race([
      outputPromise,
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Boxed probe timed out before result readback.')), 45000); }),
    ]);
  } catch (error) {
    // The child was created by this probe; do not touch any other process/box.
    if (sandboxChild.exitCode === null && sandboxChild.signalCode === null) sandboxChild.kill();
    throw error;
  } finally {
    clearTimeout(deadline);
  }
  record.candidate = candidate;
  const hostCandidateResult = JSON.parse(await fs.readFile(candidateResultPath, 'utf8'));
  assert.deepEqual(hostCandidateResult, candidate, 'Host readback of boxed candidate result differs.');
  const boxPids = readBoxPids(boxName);
  assert.ok(boxPids.includes(candidate.pid), `Candidate PID ${candidate.pid} was absent from ${boxName} PID readback.`);
  record.candidate.boxPidsWhileRunning = boxPids;
  assert.ok(candidate.vault.denied, 'The boxed Node process read a fake marker inside the fresh Chromium profile.');
  assert.ok(candidate.memory.length === 2 && candidate.memory.every(target =>
    (target.vmRead.openDenied && target.vmRead.error === 5) ||
    (!target.vmRead.vmReadGranted && !target.vmRead.rpmSucceeded && target.vmRead.rpmBytes === 0 &&
      target.vmRead.ntBytes === 0 && target.vmRead.ntStatus === '0xC0000022')),
  'Boxed PowerShell retained VM_READ access to a trusted target process.');
  const [exitCode, exitSignal] = await new Promise((resolve, reject) => {
    sandboxChild.once('close', (code, signal) => resolve([code, signal]));
    sandboxChild.once('error', reject);
  });
  assert.equal(exitCode, 0, `Boxed candidate failed: ${candidateStderr.slice(-1000)}`);
  record.checks = {
    fakeVaultMarkerReadDenied: candidate.vault.denied,
    vmReadDeniedForTrustedNodeAndFakeChrome: true,
    trustedPositiveControls: ownerEvidence.map(({role, mz, bytesRead}) => ({role, mz, bytesRead})),
    candidateExitCode: exitCode,
    candidateExitSignal: exitSignal,
  };
  record.status = 'passed';
} catch (error) {
  record.status = 'failed';
  record.error = {message: error.message, stack: error.stack};
  record.candidateOutput = candidateStdout;
  record.candidateStderr = candidateStderr;
} finally {
  if (sandboxChild && sandboxChild.exitCode === null && sandboxChild.signalCode === null) {
    await Promise.race([new Promise(resolve => sandboxChild.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
  }
  if (browserContext) {
    try { await browserContext.close(); } catch (error) { record.chromiumCloseError = error.message; record.status = 'failed'; }
  }
  try { record.boxReadbackAfter = allBoxPids(); }
  catch (error) { record.boxReadbackAfter = {unknown: error.message}; record.status = 'failed'; }
  record.finished = new Date().toISOString();
  await save();
  process.stdout.write(`${JSON.stringify({resultPath, status: record.status, boxName, chromePid: record.chromium?.pid})}\n`);
  if (record.status !== 'passed') process.exitCode = 1;
}
