import path from 'node:path';
import {mkdir,mkdtemp,readFile,realpath,stat,copyFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {atomicWrite} from './atomic-write.mjs';

const exec=promisify(execFile),names={codex:'Codex',claude:'Claude Code',gemini:'Antigravity'};
const selectionFile=root=>path.join(root,'selected-cores.json');
async function readSelection(root){
 try{return JSON.parse(await readFile(selectionFile(root),'utf8'));}
 catch(error){if(error.code==='ENOENT')return {};throw error;}
}
async function selectedFile(root,file){
 const base=await realpath(root),target=await realpath(path.resolve(root,file)),relative=path.relative(base,target);
 if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!(await stat(target)).isFile())throw Error('核心檔案不在 K 專用目錄內。');
 return target;
}

// Read once at startup. Preparing an update never changes this process's cores.
export async function selectedCoreExecutables(root,defaults){
 try{
  const selected=await readSelection(root),result={...defaults};
  for(const provider of Object.keys(names))if(selected[provider])result[provider]=await selectedFile(root,selected[provider].file);
  return result;
 }catch(error){throw Error(`K 核心選用紀錄或檔案無法讀取：${selectionFile(root)}。請依更新紀錄退回該核心；未自動換版。${error.message}`,{cause:error});}
}
const versionOf=value=>{
 const match=String(value).match(/\b(\d+\.\d+\.\d+)\b/u);
 if(!match)throw Error('無法確認官方核心版本，未套用更新。');
 return match[1];
};
const newer=(a,b)=>{const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i];return false;};
async function get(url,signal){
 const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(180000)]),headers:{'User-Agent':'K-harness-core-update'}});
 if(!response.ok)throw Error(`官方下載失敗（HTTP ${response.status}），原核心保持不變。`);
 return response;
}

// Use the vendors' published distribution metadata, never run downloaded installers.
export async function officialCoreRelease(provider,{signal,arch=process.arch,request=get}={}){
 if(!['x64','arm64'].includes(arch))throw Error('目前核心更新只支援 Windows x64／ARM64。');
 if(provider==='claude'){
  const base='https://downloads.claude.ai/claude-code-releases';
  const version=(await (await request(`${base}/latest`,signal)).text()).trim();
  if(!/^\d+\.\d+\.\d+$/u.test(version))throw Error('官方 Claude 版本資料無效。');
  const manifest=await (await request(`${base}/${version}/manifest.json`,signal)).json();
  return {version,url:`${base}/${version}/win32-${arch}/claude.exe`,algorithm:'sha256',digest:manifest.platforms?.[`win32-${arch}`]?.checksum,encoding:'hex',file:'claude.exe'};
 }
 if(provider==='gemini'){
  const manifest=await (await request(`https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/windows_${arch==='x64'?'amd64':'arm64'}.json`,signal)).json();
  if(!/^https:\/\/storage\.googleapis\.com\/antigravity-public\/antigravity-cli\//u.test(manifest.url))throw Error('官方 Antigravity 下載位置無效。');
  return {version:manifest.version,url:manifest.url,algorithm:'sha512',digest:manifest.sha512,encoding:'hex',file:'agy.exe'};
 }
 if(provider==='codex'){
  const base='https://registry.npmjs.org/@openai/codex';
  const latest=await (await request(`${base}/latest`,signal)).json();
  const dependency=latest.optionalDependencies?.[`@openai/codex-win32-${arch}`];
  if(!/^npm:@openai\/codex@\d+\.\d+\.\d+-win32-(x64|arm64)$/u.test(dependency))throw Error('官方 Codex Windows 套件資料無效。');
  const pkg=await (await request(`${base}/${dependency.slice('npm:@openai/codex@'.length)}`,signal)).json();
  if(!/^https:\/\/registry\.npmjs\.org\/@openai\/codex\/-\//u.test(pkg.dist?.tarball)||!pkg.dist?.integrity?.startsWith('sha512-'))throw Error('官方 Codex 下載資料無效。');
  // Retain the complete native bundle, including sandbox/runner support files.
  return {version:latest.version,url:pkg.dist.tarball,algorithm:'sha512',digest:pkg.dist.integrity.slice(7),encoding:'base64',archive:true,file:`package/vendor/${arch==='x64'?'x86_64':'aarch64'}-pc-windows-msvc/bin/codex.exe`};
 }
 throw Error('不支援的核心。');
}

export async function downloadCoreRelease(release,directory,{signal,request=get,run=exec}={}){
 const bytes=release.algorithm==='sha256'?32:64;
 if(typeof release.digest!=='string'||Buffer.from(release.digest,release.encoding).length!==bytes)throw Error('官方下載缺少有效校驗碼，未下載。');
 const payload=path.join(directory,release.archive?'core.tgz':release.file);
 const response=await request(release.url,signal);
 await pipeline(response.body,createWriteStream(payload,{flags:'wx'}),{signal});
 const hash=createHash(release.algorithm);for await(const chunk of createReadStream(payload))hash.update(chunk);
 if(hash.digest(release.encoding)!==release.digest)throw Error('下載檔案校驗失敗，原核心保持不變。');
 if(release.archive)await run(path.join(process.env.SystemRoot,'System32','tar.exe'),['-xf',payload,'-C',directory],{windowsHide:true,signal,timeout:120000,maxBuffer:65536});
 return selectedFile(directory,release.file);
}
async function inspectVersion(file,signal){
 const {stdout}=await exec(file,['--version'],{windowsHide:true,signal,timeout:20000,maxBuffer:65536,
  env:{...process.env,DISABLE_AUTOUPDATER:'1',AGY_CLI_DISABLE_AUTO_UPDATE:'true'}});
 return versionOf(stdout);
}

export function createCoreUpdates({root,active,release=officialCoreRelease,download=downloadCoreRelease,inspect=inspectVersion}){
 let pending=null,abort=null,closed=false;
 return {
  update(provider){
   if(!Object.hasOwn(names,provider))return Promise.reject(Error('不支援的核心。'));
   if(closed||pending)return Promise.reject(Error('核心更新正在處理或 K 正在關閉，請稍後再試。'));
   abort=new AbortController();const signal=abort.signal;
   pending=(async()=>{
    const selected=await readSelection(root),current=active[provider]?await inspect(active[provider],signal):null;
    const next=await release(provider,{signal});
    if(!/^\d+\.\d+\.\d+$/u.test(next.version))throw Error('官方核心版本資料無效。');
    if(selected[provider]?.version===next.version&&selected[provider].version!==current)return {message:`${names[provider]} ${next.version} 已準備好；離開並停止 K 後，重新開啟即生效。`,restartRequired:true};
    if(current&&!newer(next.version,current))return {message:`${names[provider]} 目前為 ${current}，沒有較新的正式版本。`,restartRequired:false};
    await mkdir(path.join(root,'updates'),{recursive:true});
    const directory=await mkdtemp(path.join(root,'updates',`${provider}-${next.version}-`));
    const file=await download(next,directory,{signal});
    if(await inspect(file,signal)!==next.version)throw Error('下載版本讀回不符，原核心保持不變。');
    let previous=selected[provider]??null;
    // The first Gemini core may be the shared official install. Preserve its binary
    // inside K without altering that installation or any login data.
    if(!previous&&provider==='gemini'&&active.gemini){
     const backup=path.join(directory,'previous','agy.exe');await mkdir(path.dirname(backup));await copyFile(active.gemini,backup);
     previous={version:current,file:path.relative(root,backup)};
    }
    selected[provider]={version:next.version,file:path.relative(root,file),previous};
    // Retain one predecessor pointer, and all old files. No deletion or live swap.
    if(selected[provider].previous)delete selected[provider].previous.previous;
    signal.throwIfAborted();
    await atomicWrite(selectionFile(root),JSON.stringify(selected,null,2)+'\n');
    return {message:`${names[provider]} ${next.version} 已準備好；離開並停止 K 後，重新開啟即生效。`,restartRequired:true};
   })().finally(()=>{pending=null;abort=null;});
   return pending;
  },
  async close(){closed=true;abort?.abort();await pending?.catch(()=>{});},
 };
}
