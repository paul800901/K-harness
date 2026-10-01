import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {mkdir,copyFile,readdir,stat} from 'node:fs/promises';
import {activateRuntime,rollbackRuntime,installationPaths,readSettings,assertStopped} from './install-runtime.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
 const key=args[i];
 if(['--fetch','--rollback','--prepare-only'].includes(key))options[key]=true;
 else if(['--root','--ref','--codex','--claude','--dictation-python','--dictation-model'].includes(key)&&args[i+1])options[key]=args[++i];
 else throw Error(`不認得的參數：${key}`);
}
function run(command,args,cwd=source){
 const result=spawnSync(command,args,{cwd,stdio:['ignore','pipe','inherit'],encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`${command} 執行失敗 (${result.status})；候選保留，未自動重試。`);
 return result.stdout.trim();
}
async function provisionProviders(p){
 for(const [key,target] of [['--codex',path.join(p.candidate,'trusted-providers/codex/codex.exe')],['--claude',path.join(p.candidate,'trusted-providers/claude.exe')]]){
  try{await stat(target);if(options[key])throw Error('既有 K 核心不由程式更新器覆寫；請另做核心版本更新。');continue;}catch(error){if(error.code!=='ENOENT')throw error;}
  const input=options[key];if(!input||path.extname(input).toLowerCase()!=='.exe')throw Error(`首次設定需要 ${key} 指定已安裝的官方原生 exe，不複製登入資料。`);
  run(path.resolve(input),['--version']);await mkdir(path.dirname(target),{recursive:true});
  if(key==='--codex'){
   for(const name of await readdir(path.dirname(path.resolve(input))))if(name.startsWith('codex-')&&name.endsWith('.exe'))await copyFile(path.join(path.dirname(path.resolve(input)),name),path.join(path.dirname(target),name));
   await copyFile(path.resolve(input),target);
  }else await copyFile(path.resolve(input),target);
 }
}
try{
 const root=path.resolve(options['--root']??source),p=installationPaths(root);
 if(options['--rollback']){console.log(JSON.stringify(await rollbackRuntime(root),null,2));process.exit(0);}
 const ref=options['--ref'];if(!ref)throw Error('請用 --ref 指定 Git 版本（首次可用 HEAD）；不自動追最新版本。');
 if(options['--fetch'])run('git',['fetch','origin','--tags']);
 const version=run('git',['rev-parse','--verify','--end-of-options',`${ref}^{commit}`]);
 const prepared=path.join(p.candidate,`prepare-${Date.now()}`);await mkdir(prepared,{recursive:true});
 const archive=`${prepared}.tar`;
 run('git',['archive','--format=tar',`--output=${archive}`,version]);
 run('tar.exe',['-xf',archive,'-C',prepared]);
 // New candidate only: npm never replaces the running runtime's dependencies.
 run('cmd.exe',['/d','/s','/c','npm ci --no-audit --no-fund'],prepared);
 run(process.execPath,['node_modules/vite/bin/vite.js','build'],prepared);
 run(process.execPath,['browser-extension/build.mjs'],prepared);
 run('powershell.exe',['-NoProfile','-File',path.join(prepared,'local-launcher/Build-K-Launcher.ps1')],prepared);
 run('cmd.exe',['/d','/s','/c','npm test'],prepared);
 if(options['--prepare-only']){console.log(JSON.stringify({version,prepared,activated:false}));process.exit(0);}
 await assertStopped();
 await provisionProviders(p);
 for(const directory of ['vault/private-state','vault/profiles','workspace','agent-home','browser-output'])await mkdir(path.join(p.candidate,directory),{recursive:true});
 const settings={...(await readSettings(root)),nodeExecutable:process.execPath};
 for(const [option,key] of [['--dictation-python','dictationPython'],['--dictation-model','dictationModel']])
  if(options[option]){await stat(path.resolve(options[option]));settings[key]=path.resolve(options[option]);}
 console.log(JSON.stringify(await activateRuntime({root,prepared,version,settings}),null,2));
 console.log('程式已套用；請執行 Start-K-Desktop.ps1。瀏覽器首次設定請另執行 scripts/Setup-K-Browser.ps1；語音環境未設定時不會自動下載。');
}catch(error){console.error(error.message);process.exitCode=1;}
