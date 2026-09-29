import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const helperPath=fileURLToPath(new URL('../scripts/Invoke-KWindowsDictation.ps1',import.meta.url));

/** Invoke Win+H only after the one-shot Windows helper verifies the active K app window. */
export function createWindowsDictation({run=runPowerShell}={}){
 return async function startDictation(){
  if(process.platform!=='win32')return {ok:false,error:'Windows 聽寫僅支援 Windows；請使用系統的 Win+H。'};
  try{return await run(helperPath);}
  catch(error){return {ok:false,error:error?.message||'無法啟動 Windows 聽寫。請手動按 Win+H。'};}
 }
}

function runPowerShell(path){
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path,'-Mode','Trigger'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',settled=false;
  const timer=setTimeout(()=>{child.kill();finish(new Error('Windows 聽寫檢查逾時。請手動按 Win+H。'));},5000);
  function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);}
  child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk);
  child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk);
  child.once('error',error=>finish(error));
  child.once('close',code=>{
   if(code!==0)return finish(new Error(stderr.trim()||'Windows 聽寫檢查失敗。請手動按 Win+H.'));
   try{finish(null,JSON.parse(stdout.trim()));}catch{finish(new Error('Windows 聽寫回覆無法辨識。請手動按 Win+H。'));}
  });
 });
}
