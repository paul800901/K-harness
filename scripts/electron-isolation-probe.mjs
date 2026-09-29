// Fake-data-only Sandboxie isolation probe. Never calls /terminate or kills a process.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {appendFileSync} from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSandboxieSpawn} from '../src/sandboxie-process.mjs';
import {createSandboxieBoxControl, isolatedAgentEnvironment} from '../src/sandboxie-control.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(root, '.runtime', 'isolation-pilot', 'sandboxie-candidate-3b6c43ee');
const boxName = 'KCandidate8';
const startExe = path.join(runtimeRoot, 'portable', 'Start.exe');
const bridgePath = path.join(root, 'src', 'sandboxie-stdio-bridge.mjs');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const fakeApp = path.join(root, 'scripts', 'electron-isolation-fake-app.cjs');
const psExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const id = `${Date.now()}-${process.pid}`;
const evidenceRoot = path.join(root, '.runtime', 'isolation-pilot', `electron-isolation-${id}`);
const workspaceRoot = path.join(runtimeRoot, 'workspace', `electron-isolation-${id}`);
const vaultRoot = path.join(runtimeRoot, 'vault');
const workspaceInput = path.join(workspaceRoot, 'workspace-input.txt');
const workspaceOutput = path.join(workspaceRoot, 'workspace-output.txt');
const vaultFake = path.join(vaultRoot, `electron-isolation-${id}.fake`);
const resultPath = path.join(evidenceRoot, 'result.json');
const fakeMarker = `K_FAKE_ELECTRON_ISOLATION_${id}`;
const env = isolatedAgentEnvironment({home: path.join(evidenceRoot, 'isolated-home')});
const control = createSandboxieBoxControl({startExe, boxName, env, timeoutMs: 15000});
let electron;
let fakeServer;
let sandboxChild;
let candidatePid;
let humanHits = 0;
const record = {started: new Date().toISOString(), status: 'running', boxName,
  scope: 'fake-data-only; no real credentials; no policy/ACL changes; only the dedicated test-run KCandidate8 lease is closed'};

async function save() {
  await fs.mkdir(evidenceRoot, {recursive: true});
  await fs.writeFile(resultPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

function readBoxPids() {
  const output = execFileSync(startExe, [`/box:${boxName}`, '/listpids'], {
    cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 15000,
  });
  const lines = output.trim().split(/\r?\n/);
  assert.ok(lines.length >= 1 && lines.every(line => /^(?:0|[1-9][0-9]*)$/.test(line)), `Invalid ${boxName} PID readback`);
  const [count, ...pids] = lines.map(Number);
  assert.equal(count, pids.length, `Incomplete ${boxName} PID readback`);
  return pids;
}

function allBoxPids() {
  const result = {};
  for (let i = 1; i <= 8; i += 1) {
    const name = `KCandidate${i}`;
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

function startFakeElectron() {
  const ownerEnv = {};
  for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP']) {
    if (typeof process.env[name] === 'string') ownerEnv[name] = process.env[name];
  }
  const child = spawn(electronExe, [fakeApp, '--remote-debugging-pipe'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe', 'ipc'],
    env: ownerEnv,
  });
  let buffer = Buffer.alloc(0);
  let stderr = '';
  let readyResolve;
  let readyReject;
  let cdpResolve;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const cdp = new Promise(resolve => { cdpResolve = resolve; });
  child.stderr.on('data', data => { stderr += data.toString('utf8'); });
  child.once('error', readyReject);
  child.on('message', message => {
    if (message?.type === 'ready') readyResolve(message);
  });
  child.stdio[4].on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    let end;
    while ((end = buffer.indexOf(0)) >= 0) {
      const message = JSON.parse(buffer.subarray(0, end).toString('utf8'));
      buffer = buffer.subarray(end + 1);
      if (message.id === 1) cdpResolve(message);
    }
  });
  child.stdio[3].on('error', error => { stderr += `\nCDP pipe write: ${error.message}`; });
  return {child, ready, cdp, get stderr() { return stderr; }};
}

function powershellScript(ownerTargets, files, port) {
  const encodedTargets = JSON.stringify(ownerTargets).replaceAll("'", "''");
  const encodedFiles = JSON.stringify(files).replaceAll("'", "''");
  return `$ErrorActionPreference='Stop'\n` +
`Add-Type -TypeDefinition @'\nusing System; using System.Runtime.InteropServices;\n` +
`public static class KIsoNative {\n` +
` [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint a,bool i,uint p);\n` +
` [DllImport("kernel32.dll",SetLastError=true)] public static extern bool ReadProcessMemory(IntPtr p,IntPtr a,byte[] b,IntPtr n,out UIntPtr r);\n` +
` [DllImport("kernel32.dll",SetLastError=true)] public static extern bool DuplicateHandle(IntPtr s,IntPtr h,IntPtr t,out IntPtr o,uint a,bool i,uint f);\n` +
` [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();\n` +
` [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);\n` +
` [DllImport("ntdll.dll")] public static extern int NtReadVirtualMemory(IntPtr p,IntPtr a,byte[] b,IntPtr n,out UIntPtr r);\n` +
` [DllImport("ntdll.dll")] public static extern int NtQueryObject(IntPtr h,int c,IntPtr b,int n,out int r);\n` +
` public static uint Granted(IntPtr h){ IntPtr b=Marshal.AllocHGlobal(56); try{int n; int s=NtQueryObject(h,0,b,56,out n); if(s<0) throw new Exception("NtQueryObject status=0x"+s.ToString("X8")); return unchecked((uint)Marshal.ReadInt32(b,4));} finally{Marshal.FreeHGlobal(b);} }\n` +
`}\n'@\n` +
`$targets='${encodedTargets}' | ConvertFrom-Json\n$files='${encodedFiles}' | ConvertFrom-Json\n` +
`$report=[ordered]@{pid=$PID;targets=@();vault=$null;workspace=$null;human=$null}\n` +
`foreach($t in $targets){$entry=[ordered]@{pid=[int]$t.pid;moduleBase=$t.moduleBase;image=$t.image;vmRead=$null;dupHandle=$null}\n` +
` $h=[KIsoNative]::OpenProcess(0x1010,$false,[uint32]$t.pid); $openErr=[Runtime.InteropServices.Marshal]::GetLastWin32Error()\n` +
` if($h -eq [IntPtr]::Zero){$entry.vmRead=[ordered]@{openDenied=$true;error=$openErr;readAttempted=$false}} else {try{$ga=[KIsoNative]::Granted($h);$buf=New-Object byte[] 2;$got=[UIntPtr]::Zero;$ok=[KIsoNative]::ReadProcessMemory($h,[IntPtr]([long]$t.moduleBase),$buf,[IntPtr]2,[ref]$got);$readErr=[Runtime.InteropServices.Marshal]::GetLastWin32Error();$ntbuf=New-Object byte[] 2;$ntgot=[UIntPtr]::Zero;$nt=[KIsoNative]::NtReadVirtualMemory($h,[IntPtr]([long]$t.moduleBase),$ntbuf,[IntPtr]2,[ref]$ntgot);$entry.vmRead=[ordered]@{openDenied=$false;grantedAccess=('0x{0:X8}' -f $ga);vmReadGranted=(($ga -band 0x10) -ne 0);rpmSucceeded=$ok;rpmBytes=$got.ToUInt64();rpmError=$readErr;ntStatus=('0x{0:X8}' -f $nt);ntBytes=$ntgot.ToUInt64()}}finally{[KIsoNative]::CloseHandle($h)|Out-Null}}\n` +
` $d=[KIsoNative]::OpenProcess(0x1040,$false,[uint32]$t.pid);$dupOpenErr=[Runtime.InteropServices.Marshal]::GetLastWin32Error()\n` +
` if($d -eq [IntPtr]::Zero){$entry.dupHandle=[ordered]@{openDenied=$true;error=$dupOpenErr;duplicateAttempted=$false;sourceHandleValidity='not-applicable'}} else {try{$ga=[KIsoNative]::Granted($d);$copy=[IntPtr]::Zero;$duped=[KIsoNative]::DuplicateHandle($d,[IntPtr]::Zero,[KIsoNative]::GetCurrentProcess(),[ref]$copy,0,$false,2);$dupErr=[Runtime.InteropServices.Marshal]::GetLastWin32Error();if($duped){[KIsoNative]::CloseHandle($copy)|Out-Null};$entry.dupHandle=[ordered]@{openDenied=$false;grantedAccess=('0x{0:X8}' -f $ga);dupHandleGranted=(($ga -band 0x40) -ne 0);duplicateSucceeded=$duped;duplicateError=$dupErr;sourceHandle='0';sourceHandleValidity='unknown';sourceValidityIndependentEvidence=$false}}finally{[KIsoNative]::CloseHandle($d)|Out-Null}}\n` +
` $report.targets+=,$entry}\n` +
`$report.vault=[ordered]@{path=$files.vault;readDenied=$false;error=$null};try{[IO.File]::ReadAllText($files.vault)|Out-Null}catch{$base=$_.Exception.GetBaseException();$hr=[int]$base.HResult;$report.vault.readDenied=($base -is [UnauthorizedAccessException] -or $base -is [Security.SecurityException] -or (($hr -band 0xffff) -eq 5));$report.vault.error=$base.GetType().FullName;$report.vault.hresult=$hr}\n` +
`$report.workspace=[ordered]@{path=$files.workspace;readWrite=$false;error=$null};try{$v=[IO.File]::ReadAllText($files.workspace);[IO.File]::WriteAllText($files.output,$v+'|BOX_WRITE_OK');$report.workspace.readWrite=([IO.File]::ReadAllText($files.output) -eq ($v+'|BOX_WRITE_OK'))}catch{$report.workspace.error=$_.Exception.GetType().Name}\n` +
`$report.human=[ordered]@{port=${port};denied=$false;error=$null};try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',${port});$c.Close()}catch{$so=$_.Exception.InnerException;if(!$so){$so=$_.Exception};$code=$so.SocketErrorCode;$report.human.error=$_.Exception.GetType().Name+':'+$code;$report.human.denied=$code -eq [Net.Sockets.SocketError]::AccessDenied}\n` +
`$report | ConvertTo-Json -Depth 8 -Compress | Write-Output\n`;
}

async function assertPortIdle(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({host: '127.0.0.1', port});
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Port ${port} state was not determined before fake bind.`)); }, 3000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error(`Port ${port} is already accepting connections; refusing fake bind.`)); });
    socket.once('error', error => {
      clearTimeout(timer);
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(new Error(`Port ${port} availability is unknown: ${error.code ?? error.message}`));
    });
  });
}

try {
  await fs.mkdir(workspaceRoot, {recursive: true});
  await fs.mkdir(vaultRoot, {recursive: true});
  await fs.mkdir(path.dirname(workspaceRoot), {recursive: true});
  await fs.mkdir(path.dirname(vaultFake), {recursive: true});
  await fs.mkdir(path.dirname(workspaceInput), {recursive: true});
  await fs.mkdir(path.dirname(env.HOME), {recursive: true});
  for (const p of [env.APPDATA, env.LOCALAPPDATA, env.TEMP, env.CODEX_HOME, env.CLAUDE_CONFIG_DIR]) await fs.mkdir(p, {recursive: true});
  await fs.writeFile(workspaceInput, fakeMarker, 'utf8');
  await fs.writeFile(vaultFake, `FAKE_ONLY_VAULT_${id}`, 'utf8');

  record.boxReadbackBefore = allBoxPids();
  assert.ok(Object.values(record.boxReadbackBefore).every(pids => pids.length === 0), 'At least one KCandidate box is occupied; refusing to launch anything.');
  await control.assertIdle();
  await assertPortIdle(47831);

  fakeServer = http.createServer((req, res) => {
    humanHits += 1;
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('K_FAKE_HUMAN_ENDPOINT_ONLY');
  });
  await new Promise((resolve, reject) => {
    fakeServer.once('error', reject);
    fakeServer.listen(47831, '127.0.0.1', resolve);
  });
  record.fakeHumanEndpoint = {address: '127.0.0.1', port: 47831, boundOnlyAfterIdleReadback: true};

  const owner = startFakeElectron();
  electron = owner.child;
  const ready = await owner.ready;
  assert.equal(ready.pid, electron.pid, 'Fake Electron main PID readback mismatch');
  electron.stdio[3].write(`${JSON.stringify({id: 1, method: 'Browser.getVersion'})}\0`);
  const cdpReply = await owner.cdp;
  assert.equal(cdpReply.id, 1, 'No response on the inherited private CDP pipe');
  record.fakeOwnerProcesses = {privateRelayNodePid: process.pid, electronMainPid: electron.pid,
    electronParentPid: process.pid, remoteDebuggingPipe: {fd3Present: Boolean(electron.stdio[3]), fd4Present: Boolean(electron.stdio[4]),
      verifiedMethod: cdpReply.result?.product ?? null}};
  record.fakeElectronStderr = owner.stderr;

  const ownerTargetsArg = [{pid: process.pid, role: 'private-cdp-relay-node'}, {pid: electron.pid, role: 'fake-electron-main'}];
  const targetJson = JSON.stringify(ownerTargetsArg);
  const psCode = ` $targets='${targetJson}' | ConvertFrom-Json; $out=@(); foreach($t in $targets){$p=[Diagnostics.Process]::GetProcessById([int]$t.pid);$m=$p.MainModule;$bytes=New-Object byte[] 2;$h=[KIsoNative]::OpenProcess(0x1010,$false,[uint32]$t.pid);if($h -eq [IntPtr]::Zero){throw 'Trusted positive-control OpenProcess failed'};try{$n=[UIntPtr]::Zero;$ok=[KIsoNative]::ReadProcessMemory($h,$m.BaseAddress,$bytes,[IntPtr]2,[ref]$n);if(!$ok -or $n.ToUInt64() -ne 2 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a){throw 'Trusted positive-control MZ read failed'};$out+=,[ordered]@{pid=$t.pid;role=$t.role;image=$m.FileName;moduleBase=$m.BaseAddress.ToInt64();bytesRead=$n.ToUInt64();mz=[Text.Encoding]::ASCII.GetString($bytes)}}finally{[KIsoNative]::CloseHandle($h)|Out-Null}};$out|ConvertTo-Json -Compress\n`;
  const hostPsFile = path.join(evidenceRoot, 'trusted-positive-control.ps1');
  const hostType = `$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\nusing System;using System.Runtime.InteropServices;public static class KIsoNative{[DllImport("kernel32.dll",SetLastError=true)]public static extern IntPtr OpenProcess(uint a,bool i,uint p);[DllImport("kernel32.dll",SetLastError=true)]public static extern bool ReadProcessMemory(IntPtr p,IntPtr a,byte[] b,IntPtr n,out UIntPtr r);[DllImport("kernel32.dll")]public static extern bool CloseHandle(IntPtr h);}\n'@\n`;
  await fs.writeFile(hostPsFile, hostType + psCode, 'utf8');
  const hostOutput = execFileSync(psExe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hostPsFile], {cwd: root, env: process.env, windowsHide: true, encoding: 'utf8', timeout: 15000});
  const ownerModuleEvidence = JSON.parse(hostOutput.trim());
  assert.equal(ownerModuleEvidence.length, 2);
  record.trustedPositiveControl = ownerModuleEvidence;

  const probeFile = path.join(workspaceRoot, 'electron-isolation-probe.ps1');
  await fs.writeFile(probeFile, powershellScript(ownerModuleEvidence, {vault: vaultFake, workspace: workspaceInput, output: workspaceOutput}, 47831), 'utf8');
  const candidateCode = `(async()=>{const {spawnSync}=require('node:child_process');const fs=require('node:fs');const http=require('node:http');const ps=${JSON.stringify(psExe)};const script=${JSON.stringify(probeFile)};const r=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:30000});if(r.error||r.status!==0)throw new Error('PowerShell probe failed: '+(r.error?.message||r.stderr));const lines=r.stdout.trim().split(/\\r?\\n/);const report=JSON.parse(lines.at(-1));let vault;try{fs.readFileSync(${JSON.stringify(vaultFake)},'utf8');vault={denied:false};}catch(e){vault={denied:['EACCES','EPERM'].includes(e.code),code:e.code};}const ws=fs.readFileSync(${JSON.stringify(workspaceInput)},'utf8');fs.writeFileSync(${JSON.stringify(workspaceOutput)},ws+'|NODE_WRITE_OK');const wsReadback=fs.readFileSync(${JSON.stringify(workspaceOutput)},'utf8');const human=await new Promise(resolve=>{const req=http.get('http://127.0.0.1:47831/');req.setTimeout(4000,()=>req.destroy(Object.assign(new Error('timeout'),{code:'ETIMEDOUT'})));req.on('response',res=>{res.resume();resolve({denied:false,status:res.statusCode});});req.on('error',e=>resolve({denied:['EACCES','EPERM'].includes(e.code),code:e.code}));});const out={status:'candidate-complete',pid:process.pid,memory:report.targets,vault:{powershell:report.vault,node:vault},workspace:{powershell:report.workspace,nodeRoundTrip:wsReadback===ws+'|NODE_WRITE_OK'},human:{powershell:report.human,node:human},powershellStderr:r.stderr};fs.writeFileSync(${JSON.stringify(path.join(workspaceRoot, 'candidate-result.json'))},JSON.stringify(out,null,2));process.stdout.write(JSON.stringify(out)+'\\n');await new Promise(resolve=>setTimeout(resolve,3000));})().catch(e=>{console.error(e.stack||e);process.exitCode=1});`;
  const runnerEnv = {...env, ELECTRON_RUN_AS_NODE: ''};
  const spawnImpl = createSandboxieSpawn({boxName, startExe, nodeExecutable: process.execPath, bridgePath,
    stopBox: control.stopBox, launcherEnv: env});
  const candidateStdoutPath = path.join(evidenceRoot, 'candidate-stdout.log');
  const candidateStderrPath = path.join(evidenceRoot, 'candidate-stderr.log');
  await fs.writeFile(candidateStdoutPath, '', 'utf8');
  await fs.writeFile(candidateStderrPath, '', 'utf8');
  sandboxChild = spawnImpl(process.execPath, ['-e', candidateCode], {cwd: workspaceRoot, env: runnerEnv});
  let output = '';
  let errors = '';
  let candidateResolve;
  let candidateReject;
  const candidateResultPromise = new Promise((resolve, reject) => {
    candidateResolve = resolve;
    candidateReject = reject;
  });
  sandboxChild.stdout.on('data', chunk => {
    output += chunk.toString('utf8');
    appendFileSync(candidateStdoutPath, chunk);
    const line = output.trim().split(/\r?\n/).at(-1);
    try { if (line.startsWith('{')) candidateResolve(JSON.parse(line)); } catch {}
  });
  sandboxChild.stderr.on('data', chunk => { errors += chunk.toString('utf8'); appendFileSync(candidateStderrPath, chunk); });
  sandboxChild.once('error', candidateReject);
  sandboxChild.once('close', (code, signal) => {
    if (code !== 0) candidateReject(new Error(`Fake candidate exited ${code ?? signal}: ${errors.slice(-2000)}`));
  });
  const candidateResult = await candidateResultPromise;
  record.candidateLogs = {stdout: candidateStdoutPath, stderr: candidateStderrPath};
  candidatePid = candidateResult.pid;
  const inBox = readBoxPids();
  assert.ok(inBox.includes(candidatePid), `Reported candidate PID ${candidatePid} absent from ${boxName} PID readback ${inBox.join(',')}`);
  assert.ok(!inBox.includes(process.pid) && !inBox.includes(electron.pid), 'Trusted owner PID unexpectedly appears inside the candidate box.');
  record.candidate = {pid: candidatePid, boxName, pidReadbackWhileRunning: inBox, result: candidateResult};

  const evidenceOutput = await fs.readFile(path.join(workspaceRoot, 'candidate-result.json'), 'utf8');
  assert.deepEqual(JSON.parse(evidenceOutput), candidateResult, 'Host readback of box-written result differs');
  assert.ok(candidateResult.memory.every(t => t.vmRead?.openDenied && t.vmRead?.error === 5 ||
    (!t.vmRead?.vmReadGranted && !t.vmRead?.rpmSucceeded && t.vmRead?.rpmBytes === 0 &&
      t.vmRead?.ntBytes === 0 && t.vmRead?.ntStatus === '0xC0000022')),
  'A fake owner process memory read was not conclusively denied.');
  assert.ok(candidateResult.memory.every(t => t.dupHandle?.openDenied && t.dupHandle?.error === 5 ||
    (!t.dupHandle?.dupHandleGranted && !t.dupHandle?.duplicateSucceeded)),
  'DUP_HANDLE remained granted or DuplicateHandle succeeded.');
  assert.ok(candidateResult.vault.node.denied && candidateResult.vault.powershell.readDenied, 'A new fake vault file was readable.');
  assert.ok(candidateResult.workspace.nodeRoundTrip && candidateResult.workspace.powershell.readWrite, 'Workspace fake-file read/write failed.');
  assert.ok(candidateResult.human.node.denied && candidateResult.human.powershell.denied, 'Human endpoint 47831 was reachable from the box.');
  assert.equal(humanHits, 0, 'The fake human endpoint received a request from the box.');
  const [candidateExitCode, candidateSignal] = await once(sandboxChild, 'close');
  assert.equal(candidateExitCode, 0, `Fake candidate did not exit cleanly: ${errors.slice(-1000)}`);
  record.checks = {memoryReadDenied: true, dupHandleDenied: true, vaultReadDenied: true,
    workspaceReadWrite: true, human47831Denied: true, humanEndpointHits: humanHits,
    candidateExitCode, candidateSignal};
  record.status = 'passed';
} catch (error) {
  record.status = 'failed';
  record.error = {message: error.message, stack: error.stack};
  record.candidateLogs = {stdout: path.join(evidenceRoot, 'candidate-stdout.log'), stderr: path.join(evidenceRoot, 'candidate-stderr.log')};
  try { record.candidateStdout = await fs.readFile(record.candidateLogs.stdout, 'utf8'); } catch {}
  try { record.candidateStderr = await fs.readFile(record.candidateLogs.stderr, 'utf8'); } catch {}
} finally {
  if (sandboxChild && sandboxChild.exitCode === null && sandboxChild.signalCode === null) {
    await Promise.race([once(sandboxChild, 'close').catch(() => {}), new Promise(resolve => setTimeout(resolve, 10000))]);
  }
  if (electron?.connected) {
    electron.send({type: 'stop-fake-only'});
    try { await Promise.race([once(electron, 'exit'), new Promise(resolve => setTimeout(resolve, 10000))]); } catch {}
  }
  if (fakeServer?.listening) await new Promise(resolve => fakeServer.close(resolve));
  try { record.boxReadbackAfter = allBoxPids(); }
  catch (error) { record.boxReadbackAfter = {unknown: error.message}; record.status = 'failed'; }
  record.fakeHumanEndpointHits = humanHits;
  record.finished = new Date().toISOString();
  await save();
  process.stdout.write(`${JSON.stringify({resultPath, status: record.status, candidatePid, boxName})}\n`);
  if (record.status !== 'passed') process.exitCode = 1;
}
