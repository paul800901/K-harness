// One-shot fake-data probe. Requires explicit root approval before execution.
// Never opens real secrets or uses any Sandboxie stop/terminate operation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createSandboxieBoxControl,isolatedAgentEnvironment} from '../src/sandboxie-control.mjs';
import {isolatedLauncherPaths} from '../src/isolated-launcher.mjs';

const GATE='--run-trusted-runtime-write-probe';
const SCRIPT=path.resolve(fileURLToPath(import.meta.url));
const ROOT=String.raw`D:\K-harness`;
const EVIDENCE=path.join(ROOT,'.runtime','isolation-pilot','trusted-runtime-write-20260926-review-01');
const CANDIDATE=String.raw`D:\K-harness\.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee`;
const BOX='KCandidate1';
const capture=promisify(execFile);
const hash=value=>createHash('sha256').update(value).digest('hex');

if(process.argv[2]!==GATE||process.argv.length!==3){
  process.stderr.write(`Refusing to run. Root review is required; explicit gate: ${GATE}\n`);
  process.exitCode=2;
} else {
  const id=randomUUID();
  const token=`K-TRUSTED-RUNTIME-WRITE-PROBE ${id}\n`;
  const rewritten=`K-TRUSTED-RUNTIME-CANARY-OVERWRITTEN ${id}\n`;
  const paths=isolatedLauncherPaths(CANDIDATE);
  const trustedRoot=paths.trustedRuntime;
  const startExe=paths.startExe;
  const control=createSandboxieBoxControl({startExe,boxName:BOX});
  const ordinary=path.join(EVIDENCE,`ordinary-workspace-write-${id}.fake`);
  const trustedCreate=path.join(trustedRoot,`k-trusted-runtime-create-${id}.fake`);
  const trustedCanary=path.join(trustedRoot,`k-trusted-runtime-canary-${id}.fake`);
  const ready=path.join(EVIDENCE,`ready-${id}.json`);
  const go=path.join(EVIDENCE,`go-${id}.fake`);
  const childResult=path.join(EVIDENCE,`child-result-${id}.json`);
  const resultPath=path.join(EVIDENCE,'result.json');
  const evidence={
    scope:'fake-data writes only: ordinary workspace positive control; trusted-runtime fake create and fake-canary overwrite; no real-file reads; no INI/ACL/box changes',
    box:BOX,runId:id,started:new Date().toISOString(),
    targets:{ordinary,trustedCreate,trustedCanary},
    statuses:{ordinary:'pending',trustedCreate:'pending',trustedCanaryOverwrite:'pending'},
  };
  const exists=async file=>{try{await fs.lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
  const wait=async(predicate,timeoutMs)=>{const end=Date.now()+timeoutMs;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Probe condition timed out.');};
  const readFake=async file=>{try{return {exists:true,text:await fs.readFile(file,'utf8')};}catch(error){if(error.code==='ENOENT')return {exists:false};throw error;}};
  const opStatus=(operation,readback,expected,baseline)=>{
    if(operation?.ok&&readback.exists&&readback.text===expected)return 'direct-write-through';
    if(operation?.ok&&(!readback.exists||readback.text===baseline))return 'sandbox-write-not-visible-at-host-path';
    if(!operation?.ok&&['EPERM','EACCES'].includes(operation?.code)&&(!readback.exists||readback.text===baseline))return 'explicitly-denied';
    return 'inconclusive';
  };
  async function effectiveOpenRules(){
    const ps=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const script=path.join(ROOT,'scripts','query-sandboxie-workspace.ps1');
    const r=await capture(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-DllPath',path.join(CANDIDATE,'portable','SbieDll.dll'),'-BoxName',BOX],{windowsHide:true,encoding:'utf8',timeout:10000});
    const rules=JSON.parse(r.stdout.replace(/^\uFEFF/,'').trim());
    assert(rules.includes(`${ROOT}\\*`),'Effective rules no longer include the expected K workspace rule.');
    return rules;
  }

  try{
    assert.equal(path.resolve(ROOT),ROOT);
    assert.equal(path.resolve(EVIDENCE),EVIDENCE);
    assert.equal(await fs.realpath(trustedRoot),trustedRoot,'Trusted runtime path is not the expected real directory.');
    assert((await fs.lstat(trustedRoot)).isDirectory(),'Trusted runtime is not a real directory.');
    assert.equal(await exists(resultPath),false,'Result path already exists; refusing to overwrite evidence.');
    for(const file of [ordinary,trustedCreate,trustedCanary,ready,go,childResult])assert.equal(await exists(file),false,`Unique probe path already exists: ${file}`);
    evidence.policyBeforeHash=hash(await fs.readFile(path.join(CANDIDATE,'portable','Sandboxie.ini')));
    evidence.effectiveOpenRulesBefore=await effectiveOpenRules();
    evidence.beforePids=await control.pids();

    // Precreate a new fake canary; later overwrite attempts can touch only this run's file.
    await fs.writeFile(trustedCanary,token,{flag:'wx'});
    await fs.writeFile(path.join(EVIDENCE,`canary-baseline-${id}.txt`),token,{flag:'wx'});
    const child=path.join(EVIDENCE,`child-${id}.cjs`);
    const childSource=`const fs=require('node:fs');\n`+
      `const ready=${JSON.stringify(ready)},go=${JSON.stringify(go)},out=${JSON.stringify(childResult)};\n`+
      `const ordinary=${JSON.stringify(ordinary)},trustedCreate=${JSON.stringify(trustedCreate)},trustedCanary=${JSON.stringify(trustedCanary)};\n`+
      `const ordinaryText=${JSON.stringify(token)},overwriteText=${JSON.stringify(rewritten)};\n`+
      `const attempt=(label,fn)=>{try{fn();return {label,ok:true};}catch(e){return {label,ok:false,code:e.code??null,message:String(e.message??e)};}};\n`+
      `fs.writeFileSync(ready,JSON.stringify({pid:process.pid}));\n`+
      `const deadline=Date.now()+20000;const timer=setInterval(()=>{if(!fs.existsSync(go)){if(Date.now()>deadline){clearInterval(timer);process.exitCode=2;}return;}clearInterval(timer);\n`+
      `const results=[attempt('ordinaryWorkspaceCreate',()=>fs.writeFileSync(ordinary,ordinaryText,{flag:'wx'})),attempt('trustedRuntimeCreate',()=>fs.writeFileSync(trustedCreate,ordinaryText,{flag:'wx'})),attempt('trustedRuntimeCanaryOverwrite',()=>fs.writeFileSync(trustedCanary,overwriteText,{flag:'w'}))];\n`+
      `fs.writeFileSync(out,JSON.stringify({pid:process.pid,results}));},100);\n`;
    await fs.writeFile(child,childSource,{flag:'wx'});
    const fakeHome=path.join(EVIDENCE,`fake-home-${id}`);
    await fs.mkdir(path.join(fakeHome,'tmp'),{recursive:true});
    const env=isolatedAgentEnvironment({home:fakeHome});
    const launcher=spawn(startExe,[`/box:${BOX}`,'/wait','/hide_window',process.execPath,child],{windowsHide:true,env,stdio:'ignore'});
    const launchExit=new Promise((resolve,reject)=>{launcher.once('error',reject);launcher.once('exit',(code,signal)=>resolve({code,signal}));});
    await wait(()=>exists(ready),20000);
    const {pid}=JSON.parse(await fs.readFile(ready,'utf8'));
    evidence.probePid=pid;
    const pids=await control.pids();
    assert(pids.includes(pid),'Probe process membership in KCandidate1 was not verified.');
    evidence.probeMembershipVerified=true;
    evidence.effectiveOpenRulesAtWrite=await effectiveOpenRules();
    assert.deepEqual(evidence.effectiveOpenRulesAtWrite,evidence.effectiveOpenRulesBefore,'Effective workspace rules changed during probe preparation.');
    await fs.writeFile(go,'ALLOW THIS FAKE-DATA WRITE PROBE',{flag:'wx'});
    await wait(()=>exists(childResult),15000);
    evidence.child=JSON.parse(await fs.readFile(childResult,'utf8'));
    evidence.launchExit=await launchExit;
    await wait(async()=>!(await control.pids()).includes(pid),10000);
    evidence.afterPids=await control.pids();
    evidence.preexistingPidsPreserved=evidence.beforePids.every(value=>evidence.afterPids.includes(value));
    evidence.effectiveOpenRulesAfter=await effectiveOpenRules();
    evidence.effectiveOpenRulesUnchanged=JSON.stringify(evidence.effectiveOpenRulesAfter)===JSON.stringify(evidence.effectiveOpenRulesBefore);
    evidence.policyAfterHash=hash(await fs.readFile(path.join(CANDIDATE,'portable','Sandboxie.ini')));
    evidence.policyUnchanged=evidence.policyBeforeHash===evidence.policyAfterHash;

    const operations=Object.fromEntries(evidence.child.results.map(value=>[value.label,value]));
    const ordinaryReadback=await readFake(ordinary);
    const createReadback=await readFake(trustedCreate);
    const canaryReadback=await readFake(trustedCanary);
    evidence.readback={ordinary:ordinaryReadback,trustedCreate:createReadback,trustedCanary:canaryReadback};
    evidence.statuses.ordinary=opStatus(operations.ordinaryWorkspaceCreate,ordinaryReadback,token,undefined);
    evidence.statuses.trustedCreate=opStatus(operations.trustedRuntimeCreate,createReadback,token,undefined);
    evidence.statuses.trustedCanaryOverwrite=opStatus(operations.trustedRuntimeCanaryOverwrite,canaryReadback,rewritten,token);
    evidence.trustedRuntimeDirectWriteThrough=[evidence.statuses.trustedCreate,evidence.statuses.trustedCanaryOverwrite].includes('direct-write-through');
    evidence.trustedRuntimeWriteClassification=evidence.trustedRuntimeDirectWriteThrough?'direct-write-through-observed':
      [evidence.statuses.trustedCreate,evidence.statuses.trustedCanaryOverwrite].some(value=>value==='sandbox-write-not-visible-at-host-path')?'sandbox-redirection-or-virtualization-observed':
      [evidence.statuses.trustedCreate,evidence.statuses.trustedCanaryOverwrite].every(value=>value==='explicitly-denied')?'explicit-denial-observed':'inconclusive';
    evidence.status=evidence.statuses.ordinary==='direct-write-through'&&evidence.probeMembershipVerified&&evidence.preexistingPidsPreserved&&evidence.policyUnchanged&&evidence.effectiveOpenRulesUnchanged?'completed':'incomplete';
    if(evidence.status!=='completed')process.exitCode=1;
  }catch(error){evidence.status='incomplete';evidence.error=error.message;process.exitCode=1;}
  finally{
    evidence.ended=new Date().toISOString();
    // Exclusive create only: preserve all evidence and never overwrite an earlier run.
    try{await fs.writeFile(resultPath,JSON.stringify(evidence,null,2),{flag:'wx'});}
    catch(error){evidence.evidenceWriteError=error.message;process.stderr.write(`Could not create new result evidence without overwriting: ${error.message}\n`);process.exitCode=1;}
    process.stdout.write(`${JSON.stringify(evidence,null,2)}\n`);
  }
}
