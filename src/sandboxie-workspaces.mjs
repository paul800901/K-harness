import {copyFile,mkdir,open,readFile,realpath,lstat,rename,stat} from 'node:fs/promises';
import {execFile as nodeExecFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createSandboxieBoxControl} from './sandboxie-control.mjs';
import os from 'node:os';
import path from 'node:path';
import {listProjects} from './projects.mjs';

const execFile=promisify(nodeExecFile);
const asPath=value=>path.resolve(value);
const key=value=>asPath(value).replace(/[\\/]+$/,'').toLocaleLowerCase('en-US');
const same=(left,right)=>key(left)===key(right);
const within=(base,target)=>{const rel=path.relative(key(base),key(target));return rel===''||(!rel.startsWith(`..${path.sep}`)&&rel!=='..'&&!path.isAbsolute(rel));};
const fileRule=workspace=>`${workspace.replace(/[\\/]+$/,'')}\\*`;
const rulePath=rule=>rule.replace(/[\\/]+\*$/,'');
const forbiddenPathChars=/[*?%\r\n]/u;

async function assertNoReparseAncestors(candidate){
 const root=path.parse(candidate).root;
 let current=root;
 for(const part of candidate.slice(root.length).split(/[\\/]+/).filter(Boolean)){
  current=path.join(current,part);
  const info=await lstat(current);
  if(info.isSymbolicLink())throw new Error(`工作區路徑含 symlink/junction：${current}`);
 }
}

/**
 * Create the path validator and slot preparation coordinator. All configuration
 * callbacks are injected so tests can prove behavior without touching Sandboxie.
 */
export function createSandboxieWorkspaces({
 boxes,baselineOpenFilePaths,protectedPaths,candidateRoot,defaultWorkspace,secretPaths=[],
 listRegisteredWorkspaces=async()=>[],assertIdle,queryOpenFilePaths,appendOpenFilePath,
 deleteOpenFilePath,reloadConfiguration,queryEffectiveOpenFilePaths,
}){
 for(const [name,fn] of Object.entries({assertIdle,queryOpenFilePaths,appendOpenFilePath,deleteOpenFilePath,reloadConfiguration,queryEffectiveOpenFilePaths}))
  if(typeof fn!=='function')throw new TypeError(`${name} must be a function`);
 const allowedBoxes=new Set(boxes??[]);
 if(!allowedBoxes.size)throw new TypeError('boxes must list dedicated Sandboxie slots');
 const initialRules=Object.fromEntries([...allowedBoxes].map(box=>[box,(baselineOpenFilePaths?.[box]??[]).map(String)]));
 const protectedList=[os.homedir(),...(protectedPaths??[])].map(asPath);
 const secrets=secretPaths.map(asPath);
 if(!protectedList.length)throw new TypeError('protectedPaths must include protected policy paths');
 const candidateBase=candidateRoot?asPath(candidateRoot):null;
 const defaultPath=defaultWorkspace?asPath(defaultWorkspace):null;
 let queue=Promise.resolve();

 const validateWorkspacePath=async candidate=>{
  if(typeof candidate!=='string'||!path.isAbsolute(candidate))throw new Error('工作區必須是絕對資料夾路徑。');
  if(forbiddenPathChars.test(candidate))throw new Error('工作區路徑含不允許的萬用字元或控制字元。');
  const resolved=asPath(candidate);
  await assertNoReparseAncestors(resolved);
  const canonical=await realpath(resolved);
  const info=await lstat(canonical);
  if(!info.isDirectory())throw new Error('工作區必須是資料夾。');
  if(same(canonical,path.parse(canonical).root))throw new Error('不能選取磁碟根目錄作為工作區。');
  const protectedCanonical=[];
  for(const item of protectedList){let value;try{value=await realpath(item);}catch{value=item;}protectedCanonical.push(value);}
  const conflict=protectedCanonical.find(item=>within(item,canonical));
  if(conflict)throw new Error(`工作區位於受保護的 Sandboxie 路徑內：${conflict}`);
  if(secrets.some(item=>same(item,canonical)))throw new Error('不能選取秘密檔所在路徑。');
  if(candidateBase&&within(candidateBase,canonical)&&!(defaultPath&&same(canonical,defaultPath)))
   throw new Error('不能選取候選執行環境本身或其子路徑（預設工作區除外）。');
  return canonical;
 };

 const performPrepare=async({boxName,cwd}={})=>{
  if(!allowedBoxes.has(boxName))throw new Error('不是可用的專用 Sandboxie slot。');
  const workspace=await validateWorkspacePath(cwd);
  const registered=await listRegisteredWorkspaces();
  if(!Array.isArray(registered)||!registered.some(value=>typeof value==='string'&&same(value,workspace)))
   throw new Error('工作區尚未登錄；拒絕調整 Sandboxie 規則。');
  const selectedRule=fileRule(workspace),baseline=initialRules[boxName];
  await assertIdle(boxName);
  const existing=await queryOpenFilePaths(boxName);
  if(!Array.isArray(existing)||existing.some(value=>typeof value!=='string'))throw new Error('無法讀回 Sandboxie.ini 的 OpenFilePath。');
  const unknown=existing.filter(value=>!baseline.some(item=>same(item,value)));
  if(unknown.length>1)throw new Error('slot 含多筆非基準 OpenFilePath；拒絕猜測哪些可移除。');
  if(unknown.length){
   const prior=rulePath(unknown[0]),registered=await listRegisteredWorkspaces();
   if(!Array.isArray(registered)||!registered.some(value=>typeof value==='string'&&same(value,prior)))
    throw new Error('slot 的既有動態 OpenFilePath 不屬於已登錄工作區；拒絕移除。');
  }
  const ruleAlreadyBaseline=baseline.some(item=>same(item,selectedRule));
  const unchanged=ruleAlreadyBaseline||unknown.length===1&&same(unknown[0],selectedRule);
  if(!unchanged){for(const prior of unknown)await deleteOpenFilePath(boxName,prior);await appendOpenFilePath(boxName,selectedRule);}
  const expected=ruleAlreadyBaseline?baseline:[...baseline,selectedRule];
  const fileReadback=await queryOpenFilePaths(boxName);
  if(!sameRules(fileReadback,expected))throw new Error('Sandboxie.ini OpenFilePath 讀回與預期不符；未啟動工作程序。');
  if(!unchanged)await reloadConfiguration();
  const effective=await queryEffectiveOpenFilePaths(boxName);
  if(!sameRules(effective,expected))throw new Error('Sandboxie 有效 OpenFilePath 讀回與預期不符；未啟動工作程序。');
  return {boxName,workspace,openFilePath:selectedRule};
 };
 const prepareWorkspace=options=>{
  const operation=queue.catch(()=>{}).then(()=>performPrepare(options));
  queue=operation.catch(()=>{});
  return operation;
 };
 return {validateWorkspacePath,prepareWorkspace};
}

function sameRules(actual,expected){
 return Array.isArray(actual)&&actual.length===expected.length&&expected.every(item=>actual.some(value=>same(item,value)));
}

function splitIni(text){
 const rows=[];let offset=0;
 for(const match of text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)){
  if(match[0]==='')continue;
  rows.push({text:match[0].replace(/(?:\r\n|\n|\r)$/u,''),ending:match[0].match(/(?:\r\n|\n|\r)$/u)?.[0]??'',start:offset,end:offset+match[0].length});
  offset+=match[0].length;
 }
 return rows;
}

function openRuleRows(text,boxName){
 const rows=splitIni(text);let section=null;const result=[];
 for(const row of rows){
  const header=row.text.match(/^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/u);
  if(header){section=header[1].trim();continue;}
  if(section?.toLocaleLowerCase('en-US')!==boxName.toLocaleLowerCase('en-US'))continue;
  const item=row.text.match(/^\s*OpenFilePath\s*=\s*(.*?)\s*(?:[;#].*)?$/iu);
  if(item)result.push({value:item[1],row});
 }
 return {rows,result};
}

/** Actual owner-side adapter. It is read-only at construction; mutation starts only in prepareWorkspace. */
export async function createSandboxieWorkspaceAccess({paths,boxNames,execFileImpl=execFile,assertIdleImpl}={}){
 if(!paths||!Array.isArray(boxNames)||!boxNames.length)throw new TypeError('paths and boxNames are required');
 const portable=path.dirname(paths.startExe),iniPath=path.join(portable,'Sandboxie.ini'),sbieDll=path.join(portable,'SbieDll.dll');
 await Promise.all([stat(iniPath),stat(sbieDll),stat(paths.startExe)]);
 const original=await readFile(iniPath);
 const encoding=original[0]===0xff&&original[1]===0xfe?'utf16le':'utf8';
 const root=asPath(paths.root),defaultWorkspace=asPath(paths.workspace),vault=asPath(paths.vault);
 const baseline=box=>[fileRule(asPath(paths.agentHome)),fileRule(asPath(paths.browserOutput))];
 const baselineOpenFilePaths=Object.fromEntries(boxNames.map(box=>[box,baseline(box)]));
 const backupPath=path.join(vault,'Sandboxie.ini.pre-workspace-access.bak');
 let backupReady=false,mutationQueue=Promise.resolve();
 const withMutationLock=fn=>{const operation=mutationQueue.catch(()=>{}).then(fn);mutationQueue=operation.catch(()=>{});return operation;};
 const ensureBackup=async()=>{
  if(backupReady)return;
  await mkdir(vault,{recursive:true});
  try{await copyFile(iniPath,backupPath,1);}
  catch(error){if(error.code!=='EEXIST')throw error;const backup=await readFile(backupPath);if(!backup.length)throw new Error('Sandboxie.ini 備份已存在但為空；拒絕修改。');}
  backupReady=true;
 };
 const readText=async()=>{const value=await readFile(iniPath,encoding);if(value.includes('\uFFFD'))throw new Error('Sandboxie.ini 含無法解碼字元；拒絕修改。');return value;};
 const queryOpenFilePaths=async boxName=>{
  if(!boxNames.includes(boxName))throw new Error('未知 Sandboxie slot。');
  const {result}=openRuleRows(await readText(),boxName);return result.map(item=>item.value);
 };
 const mutate=async(boxName,action,value)=>withMutationLock(async()=>{
  if(!boxNames.includes(boxName))throw new Error('未知 Sandboxie slot。');
  if(typeof value!=='string'||forbiddenPathChars.test(rulePath(value)))throw new Error('OpenFilePath 值不合法。');
  const text=await readText(),{rows,result}=openRuleRows(text,boxName);
  const matched=result.filter(item=>same(item.value,value));
  let changed;
  if(action==='delete'){
   if(matched.length!==1)throw new Error('指定的 OpenFilePath 不唯一或不存在。');
   const row=matched[0].row;changed=text.slice(0,row.start)+text.slice(row.end);
  }else{
   if(matched.length)throw new Error('指定的 OpenFilePath 已存在。');
   const sectionRow=rows.findIndex(row=>new RegExp(`^\\s*\\[${escapeRegExp(boxName)}\\]\\s*(?:[;#].*)?$`,'iu').test(row.text));
   if(sectionRow<0)throw new Error('Sandboxie.ini 缺少目標 slot 區段。');
   let insertAt=sectionRow+1;while(insertAt<rows.length&&!/^\s*\[[^\]]+\]/u.test(rows[insertAt].text))insertAt++;
   const ending=rows.find(row=>row.ending)?.ending??'\r\n';
   const position=insertAt<rows.length?rows[insertAt].start:text.length;
   const prefix=position>0&&!/(?:\r\n|\n|\r)$/u.test(text.slice(0,position))?ending:'';
   changed=text.slice(0,position)+prefix+`OpenFilePath=${value}${ending}`+text.slice(position);
  }
  if(changed===text)return;
  await ensureBackup();
  const temp=`${iniPath}.workspace-${process.pid}-${Date.now()}.tmp`;
  try{await writeIniExclusive(temp,changed,encoding);await rename(temp,iniPath);}
  catch(error){throw error;}
 });
 const listRegisteredWorkspaces=async()=>{
  const {projects=[]}=await listProjects(paths.stateRoot);
  return [defaultWorkspace,...projects.map(project=>project.path)];
 };
 const run=async(executable,args)=>{
  const result=await execFileImpl(executable,args,{windowsHide:true,encoding:'buffer',maxBuffer:1024*1024});
  return Buffer.isBuffer(result.stdout)?result.stdout.toString('utf8'):String(result.stdout??'');
 };
 const queryEffectiveOpenFilePaths=async boxName=>{
  if(!boxNames.includes(boxName))throw new Error('未知 Sandboxie slot。');
  const output=await run(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
   ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../scripts/query-sandboxie-workspace.ps1',import.meta.url)),'-DllPath',sbieDll,'-BoxName',boxName]);
  const values=JSON.parse(output.replace(/^\uFEFF/u,'').trim());
  if(!Array.isArray(values)||values.some(value=>typeof value!=='string'||value.includes('\uFFFD')))throw new Error('Sandboxie 有效設定讀回不完整；未啟動工作程序。');
  return values;
 };
 const controls=new Map(boxNames.map(boxName=>[boxName,createSandboxieBoxControl({startExe:paths.startExe,boxName})]));
 return createSandboxieWorkspaces({
  boxes:boxNames,baselineOpenFilePaths,protectedPaths:[vault,paths.trustedRuntime,paths.trustedProviders,paths.agentHome,paths.browserProfiles,paths.browserOutput,
   path.resolve(root,'..','..','..','installed','k-browser-assistant')],
  candidateRoot:root,defaultWorkspace,secretPaths:[path.join(path.resolve(root,'..','..','..'),'.env.local')],listRegisteredWorkspaces,
  assertIdle:boxName=>assertIdleImpl?assertIdleImpl(boxName):controls.get(boxName).assertIdle(),queryOpenFilePaths,
  appendOpenFilePath:(box,value)=>mutate(box,'append',value),deleteOpenFilePath:(box,value)=>mutate(box,'delete',value),
  reloadConfiguration:async()=>{await run(paths.startExe,['/reload']);},queryEffectiveOpenFilePaths,
 });
}

function escapeRegExp(value){return value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');}
async function writeIniExclusive(file,text,encoding){
 const handle=await open(file,'wx');try{await handle.writeFile(text,encoding);await handle.sync();}finally{await handle.close();}
}
