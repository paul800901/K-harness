// Narrow fake-file test for the fixed installed Chrome extension directory.
// It changes only ReadFilePath entries in KCandidate1..8 after strict idle and
// loopback-port preflight. It never edits extension source files.
import assert from 'node:assert/strict';
import {copyFile, mkdir, open, readFile, readdir, rename, stat, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSandboxieSpawn} from '../src/sandboxie-process.mjs';
import {createSandboxieBoxControl, isolatedAgentEnvironment} from '../src/sandboxie-control.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(projectRoot, '.runtime', 'isolation-pilot', 'sandboxie-candidate-3b6c43ee');
const portableRoot = path.join(runtimeRoot, 'portable');
const startExe = path.join(portableRoot, 'Start.exe');
const iniPath = path.join(portableRoot, 'Sandboxie.ini');
const sbieDll = path.join(portableRoot, 'SbieDll.dll');
const bridgePath = path.join(projectRoot, 'src', 'sandboxie-stdio-bridge.mjs');
const installedExtension = path.join(projectRoot, 'installed', 'k-browser-assistant');
const protectedRule = `${installedExtension}\\*`;
const testBox = 'KCandidate3'; // Its existing OpenFilePath is D:\K-harness\*.
const boxNames = Array.from({length: 8}, (_, index) => `KCandidate${index + 1}`);
const id = `${Date.now()}-${process.pid}`;
const evidenceRoot = path.join(projectRoot, '.runtime', 'k-browser-assistant-20260927', `installed-extension-protection-${id}`);
const backupPath = path.join(evidenceRoot, 'Sandboxie.ini.before.bak');
const workspaceRoot = path.join(projectRoot, '.runtime', 'k-browser-assistant-20260927', `readonly-workspace-${id}`);
const fakeDir = path.join(installedExtension, `sandboxie-readonly-probe-${id}`);
const fakeFile = path.join(fakeDir, 'fake-existing.txt');
const newFakeFile = path.join(fakeDir, 'fake-new.txt');
const workspaceMarker = path.join(workspaceRoot, 'workspace-write-proof.txt');
const resultPath = path.join(evidenceRoot, 'result.json');
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const env = isolatedAgentEnvironment({home: path.join(runtimeRoot, 'agent-home')});
const control = createSandboxieBoxControl({startExe, boxName: testBox, timeoutMs: 15000});
const fakeText = `FAKE_ONLY_EXTENSION_PROTECTION_${id}`;
const extensionManifestBefore = await manifestExtension();
const record = {
  started: new Date().toISOString(),
  status: 'running',
  scope: 'fixed installed extension read-only policy for eight isolated boxes; fake-only write tests; no source-file edits, no ACL/policy broadening',
  extensionPath: installedExtension,
  extensionFilesBefore: extensionManifestBefore,
  fakePaths: {fakeDir, fakeFile, newFakeFile, workspaceMarker},
  configuration: {iniPath, backupPath, protectedRule, testBox},
};
let sandboxChild;

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function manifestExtension() {
  const entries = [];
  async function walk(folder) {
    for (const item of await readdir(folder, {withFileTypes: true})) {
      if (item.name.startsWith('sandboxie-readonly-probe-')) continue;
      const full = path.join(folder, item.name);
      if (item.isDirectory()) await walk(full);
      else if (item.isFile()) {
        const bytes = await readFile(full);
        entries.push({path: path.relative(installedExtension, full), bytes: bytes.length, sha256: sha256(bytes)});
      }
    }
  }
  await walk(installedExtension);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function readAllBoxPids() {
  const snapshots = {};
  for (const boxName of boxNames) {
    const output = execFileSync(startExe, [`/box:${boxName}`, '/listpids'], {
      cwd: projectRoot, env, windowsHide: true, encoding: 'utf8', timeout: 15000,
    });
    const lines = output.trim().split(/\r?\n/);
    assert.ok(lines.length >= 1 && lines.every(line => /^(?:0|[1-9][0-9]*)$/.test(line)), `Invalid ${boxName} PID readback`);
    const [count, ...pids] = lines.map(Number);
    assert.equal(count, pids.length, `Incomplete ${boxName} PID readback`);
    snapshots[boxName] = pids;
  }
  return snapshots;
}

async function assertPort47831Closed() {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({host: '127.0.0.1', port: 47831});
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Port 47831 state was not determined.')); }, 3000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('Port 47831 has a listener.')); });
    socket.once('error', error => {
      clearTimeout(timer);
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(new Error(`Port 47831 listener state is unknown: ${error.code ?? error.message}`));
    });
  });
}

function splitRows(text) {
  const rows = [];
  let offset = 0;
  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)) {
    if (!match[0]) continue;
    rows.push({text: match[0].replace(/(?:\r\n|\n|\r)$/u, ''), start: offset, end: offset + match[0].length});
    offset += match[0].length;
  }
  return rows;
}

function iniRules(text, wantedBoxes, keyName) {
  const result = Object.fromEntries(wantedBoxes.map(name => [name, []]));
  let section = null;
  for (const row of splitRows(text)) {
    const header = row.text.match(/^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/u);
    if (header) { section = header[1].trim(); continue; }
    if (section && Object.hasOwn(result, section)) {
      const item = row.text.match(new RegExp(`^\\s*${keyName}\\s*=\\s*(.*?)\\s*(?:[;#].*)?$`, 'iu'));
      if (item) result[section].push(item[1]);
    }
  }
  return result;
}

function samePath(value) { return value.replace(/[\\/]+$/u, '').replaceAll('/', '\\').toLocaleLowerCase('en-US'); }

function addRules(text, wantedBoxes) {
  const ending = text.includes('\r\n') ? '\r\n' : text.includes('\n') ? '\n' : '\r';
  const rows = splitRows(text);
  const additions = [];
  let section = null;
  let sectionStart = -1;
  const sections = [];
  for (const row of rows) {
    const header = row.text.match(/^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/u);
    if (!header) continue;
    if (section !== null) sections.push({name: section, start: sectionStart, end: row.start});
    section = header[1].trim();
    sectionStart = row.start;
  }
  if (section !== null) sections.push({name: section, start: sectionStart, end: text.length});
  const existing = iniRules(text, wantedBoxes, 'ReadFilePath');
  const insertions = [];
  for (const name of wantedBoxes) {
    const rowsForRule = existing[name] ?? [];
    if (rowsForRule.filter(value => samePath(value) === samePath(protectedRule)).length > 1) {
      throw new Error(`${name} already has duplicate fixed-extension ReadFilePath entries.`);
    }
    if (rowsForRule.some(value => samePath(value) === samePath(protectedRule))) continue;
    const sec = sections.find(value => value.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'));
    if (!sec) throw new Error(`Sandboxie.ini is missing [${name}].`);
    const preceding = text.slice(0, sec.end);
    const prefix = preceding.length && !/(?:\r\n|\n|\r)$/u.test(preceding) ? ending : '';
    insertions.push({offset: sec.end, value: `${prefix}ReadFilePath=${protectedRule}${ending}`, name});
  }
  for (const insertion of insertions.sort((left, right) => right.offset - left.offset)) {
    text = text.slice(0, insertion.offset) + insertion.value + text.slice(insertion.offset);
  }
  additions.push(...insertions.map(({name}) => name));
  return {text, addedBoxes: additions};
}

function effectiveReadFilePathScript(names) {
  const encoded = Buffer.from(JSON.stringify(names), 'utf8').toString('base64');
  return `$ErrorActionPreference='Stop'\n[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\n` +
`Add-Type -TypeDefinition @'\nusing System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;public static class KReadPathQuery{[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr LoadLibrary(string p);[DllImport("SbieDll.dll",CharSet=CharSet.Unicode,CallingConvention=CallingConvention.StdCall)]public static extern int SbieApi_QueryConf(string box,string key,uint index,StringBuilder output,uint length);public static readonly int End=unchecked((int)0xC000008B);public static string[] Read(string box,string key){var values=new List<string>();for(uint i=0;i<1024;i++){var b=new StringBuilder(8192);int r=SbieApi_QueryConf(box,key,i|0x30000000u,b,16384);if(r==End)return values.ToArray();if(r!=0)throw new Exception("SbieApi_QueryConf failed: 0x"+r.ToString("X8"));values.Add(b.ToString());}throw new Exception("SbieApi_QueryConf exceeded limit");}}\n'@\n` +
`if([KReadPathQuery]::LoadLibrary('${sbieDll.replaceAll("'", "''")}') -eq [IntPtr]::Zero){throw 'Could not load trusted Sandboxie DLL'};$boxes=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json;$out=@();foreach($box in $boxes){$out+=,[ordered]@{box=[string]$box;ReadFilePath=@([KReadPathQuery]::Read([string]$box,'ReadFilePath'));OpenFilePath=@([KReadPathQuery]::Read([string]$box,'OpenFilePath'))}};$out|ConvertTo-Json -Depth 5 -Compress\n`;
}

async function writeAtomicIni(text, encoding) {
  const temp = `${iniPath}.readonly-probe-${process.pid}-${Date.now()}.tmp`;
  const handle = await open(temp, 'wx');
  try { await handle.writeFile(text, encoding); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, iniPath);
}

async function captureState() {
  const current = await readFile(iniPath);
  const encoding = current[0] === 0xff && current[1] === 0xfe ? 'utf16le' : 'utf8';
  const text = current.toString(encoding);
  return {current, encoding, text, config: iniRules(text, boxNames, 'ReadFilePath'), openConfig: iniRules(text, boxNames, 'OpenFilePath')};
}

async function save() {
  await mkdir(evidenceRoot, {recursive: true});
  await writeFile(resultPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

try {
  const beforeBoxes = readAllBoxPids();
  record.boxReadbackBefore = beforeBoxes;
  assert.deepEqual(Object.values(beforeBoxes).filter(pids => pids.length), [], 'At least one KCandidate1..8 box is occupied; refusing policy mutation and test.');
  await control.assertIdle();
  await assertPort47831Closed();
  record.port47831Before = 'ECONNREFUSED';
  record.iniBefore = await captureState();
  record.iniBefore.sha256 = sha256(record.iniBefore.current);
  record.iniBefore.current = undefined;
  record.iniBefore.readOnlyRules = record.iniBefore.config;
  record.iniBefore.openRules = record.iniBefore.openConfig;
  delete record.iniBefore.config;
  delete record.iniBefore.openConfig;
  const rawBefore = await readFile(iniPath);
  const encoding = rawBefore[0] === 0xff && rawBefore[1] === 0xfe ? 'utf16le' : 'utf8';
  const beforeText = rawBefore.toString(encoding);
  const existingRules = iniRules(beforeText, boxNames, 'ReadFilePath');
  record.iniBefore.protectedReadPathPresent = Object.fromEntries(boxNames.map(name => [name,
    existingRules[name].filter(value => samePath(value) === samePath(protectedRule)).length]));
  await mkdir(evidenceRoot, {recursive: true});
  await copyFile(iniPath, backupPath, 1);
  record.backup = {path: backupPath, sha256: sha256(await readFile(backupPath)), bytes: (await stat(backupPath)).size};
  await mkdir(workspaceRoot, {recursive: true});
  await mkdir(fakeDir, {recursive: true});
  await writeFile(fakeFile, fakeText, 'utf8');

  const plan = addRules(beforeText, boxNames);
  record.iniChange = {addedBoxes: plan.addedBoxes, addedRuleCount: plan.addedBoxes.length, rule: `ReadFilePath=${protectedRule}`};
  if (plan.text !== beforeText) {
    await writeAtomicIni(plan.text, encoding);
    execFileSync(startExe, ['/reload'], {cwd: projectRoot, env: process.env, windowsHide: true, timeout: 15000});
  }
  const writtenIni = await readFile(iniPath, encoding);
  assert.equal(writtenIni, plan.text, 'Sandboxie.ini exact file readback differs from minimal append plan.');
  record.iniAfter = {sha256: sha256(await readFile(iniPath)), rules: iniRules(writtenIni, boxNames, 'ReadFilePath')};
  const effectiveQueryPath = path.join(evidenceRoot, 'query-effective-paths.ps1');
  await writeFile(effectiveQueryPath, effectiveReadFilePathScript(boxNames), 'utf8');
  const queryOutput = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', effectiveQueryPath], {
    cwd: projectRoot, env: process.env, windowsHide: true, encoding: 'utf8', timeout: 20000,
  });
  record.effectiveAfter = JSON.parse(queryOutput.replace(/^\uFEFF/u, '').trim());
  for (const row of record.effectiveAfter) {
    assert.ok(row.ReadFilePath.some(value => samePath(value) === samePath(protectedRule)), `Effective ReadFilePath missing from ${row.box}.`);
    assert.deepEqual(row.OpenFilePath, record.iniBefore.openRules[row.box], `Unexpected OpenFilePath change in ${row.box}.`);
  }
  const afterBoxesBeforeTest = readAllBoxPids();
  record.boxReadbackBeforeTest = afterBoxesBeforeTest;
  assert.deepEqual(Object.values(afterBoxesBeforeTest).filter(pids => pids.length), [], 'A box became active during policy update; refusing to launch the fake candidate.');
  await control.assertIdle();
  await assertPort47831Closed();

  const candidateCode = `(async()=>{const fs=require('node:fs');let read;try{read=fs.readFileSync(${JSON.stringify(fakeFile)},'utf8')}catch(e){read=null}const attempt=(fn)=>{try{fn();return{denied:false}}catch(e){return{denied:['EACCES','EPERM','EROFS'].includes(e.code),code:e.code||null}}};const overwrite=attempt(()=>fs.writeFileSync(${JSON.stringify(fakeFile)},'FAKE_OVERWRITE_MUST_FAIL'));const create=attempt(()=>fs.writeFileSync(${JSON.stringify(newFakeFile)},'FAKE_CREATE_MUST_FAIL',{flag:'wx'}));fs.writeFileSync(${JSON.stringify(workspaceMarker)},'K_WORKSPACE_WRITE_OK');const workspace=fs.readFileSync(${JSON.stringify(workspaceMarker)},'utf8');const out={status:'candidate-complete',pid:process.pid,read,overwrite,create,workspace};process.stdout.write(JSON.stringify(out)+'\\n');await new Promise(resolve=>setTimeout(resolve,5000));})().catch(e=>{console.error(e.stack||e);process.exitCode=1});`;
  const spawnImpl = createSandboxieSpawn({boxName: testBox, startExe, nodeExecutable: process.execPath, bridgePath,
    stopBox: control.stopBox, launcherEnv: env});
  sandboxChild = spawnImpl(process.execPath, ['-e', candidateCode], {cwd: workspaceRoot, env});
  let candidateOutput = '';
  let candidate;
  const outputPromise = new Promise((resolve, reject) => {
    sandboxChild.stdout.on('data', chunk => {
      candidateOutput += chunk.toString('utf8');
      const line = candidateOutput.trim().split(/\r?\n/).at(-1);
      try { const parsed = JSON.parse(line); if (parsed.status === 'candidate-complete') { candidate = parsed; resolve(parsed); } } catch {}
    });
    sandboxChild.stderr.on('data', chunk => { record.candidateStderr = (record.candidateStderr ?? '') + chunk.toString('utf8'); });
    sandboxChild.once('error', reject);
    sandboxChild.once('close', (code, signal) => { if (code !== 0) reject(new Error(`Fake candidate exited ${code ?? signal}: ${record.candidateStderr ?? ''}`)); });
  });
  candidate = await outputPromise;
  record.candidate = candidate;
  record.candidateOutput = candidateOutput;
  const runningPids = readAllBoxPids();
  record.boxReadbackWhileCandidate = runningPids;
  assert.ok(runningPids[testBox].includes(candidate.pid), 'Candidate PID was not visible in its Sandboxie box.');
  assert.deepEqual(Object.entries(runningPids).filter(([name, pids]) => name !== testBox && pids.length), [], 'Another box became active during the candidate run.');
  assert.equal(candidate.read, fakeText, 'Boxed candidate could not read the existing fake file.');
  assert.ok(candidate.overwrite.denied, 'Boxed candidate was able to overwrite the fake extension file.');
  assert.ok(candidate.create.denied, 'Boxed candidate was able to create a new file in the protected extension folder.');
  assert.equal(candidate.workspace, 'K_WORKSPACE_WRITE_OK', 'Broad K-harness workspace write/read control failed.');
  assert.equal(await readFile(fakeFile, 'utf8'), fakeText, 'Host fake source file changed after the boxed write attempt.');
  await stat(newFakeFile).then(() => { throw new Error('A host-side fake extension file was created despite the denial result.'); }, error => { if (error.code !== 'ENOENT') throw error; });
  assert.equal(await readFile(workspaceMarker, 'utf8'), 'K_WORKSPACE_WRITE_OK', 'Host cannot read back the workspace write control.');
  const [candidateExitCode, candidateExitSignal] = await new Promise((resolve, reject) => {
    sandboxChild.once('close', (code, signal) => resolve([code, signal]));
    sandboxChild.once('error', reject);
  });
  assert.equal(candidateExitCode, 0, `Candidate exit was not clean: ${record.candidateStderr ?? ''}`);
  record.checks = {readExistingFakeFile: true, overwriteDenied: true, createDenied: true,
    broadWorkspaceWriteRead: true, originalFakeFileUnchanged: true, failedCreatedFileAbsentOnHost: true, candidateExitCode};
  record.candidateExitSignal = candidateExitSignal;
  record.extensionFilesAfter = await manifestExtension();
  assert.deepEqual(record.extensionFilesAfter, extensionManifestBefore, 'An installed extension file changed during the probe.');
  record.status = 'passed';
} catch (error) {
  record.status = 'failed';
  record.error = {message: error.message, stack: error.stack};
  try { record.extensionFilesAfter = await manifestExtension(); } catch {}
} finally {
  if (sandboxChild) {
    // This waits only for our own candidate process; it never terminates a box.
    await Promise.race([new Promise(resolve => sandboxChild.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
  }
  try { record.boxReadbackAfter = readAllBoxPids(); }
  catch (error) { record.boxReadbackAfter = {unknown: error.message}; record.status = 'failed'; }
  try { await assertPort47831Closed(); record.port47831After = 'ECONNREFUSED'; }
  catch (error) { record.port47831After = error.message; record.status = 'failed'; }
  record.finished = new Date().toISOString();
  await save();
  process.stdout.write(`${JSON.stringify({status: record.status, resultPath, backupPath, addedRuleCount: record.iniChange?.addedRuleCount ?? null, testBox})}\n`);
  if (record.status !== 'passed') process.exitCode = 1;
}

