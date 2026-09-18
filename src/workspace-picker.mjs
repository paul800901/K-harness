import {execFile} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function pickWorkspaceDirectory({path:initialPath,signal}={}) {
  if(process.platform!=='win32')throw new Error('目前的資料夾選擇器需要 Windows。');
  const executable=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const script=fileURLToPath(new URL('../scripts/pick-workspace.ps1',import.meta.url));
  return new Promise((resolve,reject)=>{
    const child=execFile(executable,['-NoProfile','-STA','-NonInteractive','-File',script],
      {windowsHide:true,encoding:'utf8',maxBuffer:65536,signal},(error,stdout)=>{
        if(error){reject(new Error(signal?.aborted?'資料夾選擇已取消。':'無法開啟 Windows 資料夾選擇器。',{cause:error}));return;}
        try {
          const result=JSON.parse(stdout);
          if(result.cancelled===true)resolve({cancelled:true});
          else if(result.cancelled===false&&typeof result.path==='string'&&result.path)resolve({cancelled:false,path:result.path});
          else throw new Error('Invalid picker result');
        } catch(error) {reject(new Error('資料夾選擇結果無法讀取。',{cause:error}));}
      });
    child.stdin.on('error',()=>{}); // A spawn failure is reported by execFile.
    child.stdin.end(JSON.stringify({path:initialPath??''}));
  });
}
