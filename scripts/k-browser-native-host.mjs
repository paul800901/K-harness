import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,readFile,rename,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {WebSocketServer} from 'ws';

const execFile=promisify(execFileCallback);
export const K_EXTENSION_ID='jhbfglfjhiebacbkjnohgmpgcppadblm';
const ORIGIN=`chrome-extension://${K_EXTENSION_ID}/`;
const MAX_NATIVE_MESSAGE_BYTES=1024*1024;
const MAX_WEBSOCKET_MESSAGE_BYTES=128*1024;
const REQUEST_TIMEOUT_MS=10_000;
const DEFAULT_DIAGNOSTIC_PATH=path.join(path.dirname(fileURLToPath(import.meta.url)),'k-browser-native-host.diagnostic.json');

export function encodeNativeMessage(value){
 const body=Buffer.from(JSON.stringify(value),'utf8');
 if(body.length===0||body.length>MAX_NATIVE_MESSAGE_BYTES)throw new Error('Invalid native message size.');
 const frame=Buffer.allocUnsafe(4+body.length);frame.writeUInt32LE(body.length,0);body.copy(frame,4);return frame;
}

export class NativeMessageDecoder{
 #buffer=Buffer.alloc(0);
 push(chunk){
  if(!Buffer.isBuffer(chunk))chunk=Buffer.from(chunk);
  this.#buffer=this.#buffer.length?Buffer.concat([this.#buffer,chunk]):chunk;
  const messages=[];
  while(this.#buffer.length>=4){
   const size=this.#buffer.readUInt32LE(0);
   if(size===0||size>MAX_NATIVE_MESSAGE_BYTES)throw new Error('Invalid native message size.');
   if(this.#buffer.length<4+size)break;
   const body=this.#buffer.subarray(4,4+size);this.#buffer=this.#buffer.subarray(4+size);
   let message;try{message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{throw new Error('Invalid native message JSON.');}
   messages.push(message);
  }
  return messages;
 }
}

export function parseHostArguments(argv){
 if(!Array.isArray(argv)||argv[0]!=='--config'||typeof argv[1]!=='string'||!path.isAbsolute(argv[1]))throw new Error('Invalid native host arguments.');
 const forwarded=argv.slice(2);
 if(forwarded.shift()!==ORIGIN)throw new Error('Native host origin is not allowed.');
 if(forwarded.some((arg,index)=>!/^--parent-window=\d+$/.test(arg)||index>0))throw new Error('Invalid native host arguments.');
 return {configPath:path.normalize(argv[1])};
}

export function validateHostConfig(config){
 if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Invalid native host config.');
 const keys=Object.keys(config).sort();
 if(keys.join(',')!=='descriptorPath,extensionId,profileDirectory')throw new Error('Invalid native host config fields.');
 if(config.extensionId!==K_EXTENSION_ID)throw new Error('Native host extension is not allowed.');
 if(typeof config.profileDirectory!=='string'||!path.isAbsolute(config.profileDirectory))throw new Error('Invalid Chrome profile directory.');
 if(typeof config.descriptorPath!=='string'||!path.isAbsolute(config.descriptorPath))throw new Error('Invalid descriptor path.');
 if(path.resolve(config.profileDirectory).toLowerCase()===path.resolve(config.descriptorPath).toLowerCase())throw new Error('Invalid descriptor path.');
 return {extensionId:config.extensionId,profileDirectory:path.resolve(config.profileDirectory),descriptorPath:path.resolve(config.descriptorPath)};
}

function normalizedLoopback(address){return address==='127.0.0.1'||address==='::ffff:127.0.0.1';}
export function isAuthorizedUpgrade(request,expectedHost,token){
 if(!normalizedLoopback(request.socket?.remoteAddress)||request.headers?.host!==expectedHost||request.headers?.origin!==undefined)return false;
 const actual=Buffer.from(typeof request.headers?.authorization==='string'?request.headers.authorization:'','utf8');
 const expected=Buffer.from(`Bearer ${token}`,'utf8');
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

export function validateConnectUrl(rawUrl,extensionId=K_EXTENSION_ID){
 if(extensionId!==K_EXTENSION_ID||typeof rawUrl!=='string'||rawUrl.length>16_384)throw new Error('Invalid connect URL.');
 let url;try{url=new URL(rawUrl);}catch{throw new Error('Invalid connect URL.');}
 if(url.protocol!=='chrome-extension:'||url.hostname!==extensionId||url.port||url.pathname!=='/connect.html'||url.username||url.password||url.hash)throw new Error('Connect URL is outside the approved extension page.');
 const allowed=new Set(['mcpRelayUrl','client','protocolVersion','mode','newTab']);
 for(const key of url.searchParams.keys())if(!allowed.has(key))throw new Error('Connect URL has an unsupported parameter.');
 for(const key of allowed)if(url.searchParams.getAll(key).length!==1)throw new Error('Connect URL is missing or duplicates a required parameter.');
 const relay=url.searchParams.get('mcpRelayUrl');
 if(!/^ws:\/\/127\.0\.0\.1:(?:[1-9]\d{0,4})\/extension\/[a-f0-9]{64}$/.test(relay??''))throw new Error('Connect URL relay is not an approved local endpoint.');
 const relayPort=Number(new URL(relay).port);if(relayPort<1||relayPort>65535)throw new Error('Connect URL relay port is invalid.');
 if(!['regular','incognito'].includes(url.searchParams.get('mode'))||url.searchParams.get('newTab')!=='true'||url.searchParams.get('protocolVersion')!=='2')throw new Error('Connect URL mode or protocol is invalid.');
 let client;try{client=JSON.parse(url.searchParams.get('client'));}catch{throw new Error('Connect URL client descriptor is invalid.');}
 if(!client||typeof client!=='object'||Array.isArray(client)||typeof client.name!=='string'||client.name.length>128)throw new Error('Connect URL client descriptor is invalid.');
 return url.toString();
}

const POWERSHELL_PARENT_CHECK=`$ErrorActionPreference='Stop'
$expected=[IO.Path]::GetFullPath($env:K_BROWSER_EXPECTED_PROFILE).TrimEnd('\\')
$current=[int]$env:K_BROWSER_TARGET_PID
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class KBrowserNativeArgv {
 [DllImport("shell32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
 [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr memory);
}
"@
for($depth=0;$depth -lt 6 -and $current -gt 0;$depth++){
 try{$process=Get-CimInstance Win32_Process -Filter "ProcessId = $current" -ErrorAction Stop}catch{break}
 if(!$process){break}
 if($process.Name -ieq 'chrome.exe'){
  $argc=0;$argv=[KBrowserNativeArgv]::CommandLineToArgvW([string]$process.CommandLine,[ref]$argc)
  if($argv -eq [IntPtr]::Zero){break}
  try{
   $values=@()
   for($i=0;$i -lt $argc;$i++){
    $arg=[Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::ReadIntPtr($argv,$i*[IntPtr]::Size))
    if($arg -match '^--user-data-dir=(.*)$'){$values+=,$Matches[1]}
    elseif($arg -eq '--user-data-dir'){
     if($i+1 -lt $argc){$i++;$values+=,[Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::ReadIntPtr($argv,$i*[IntPtr]::Size))}else{$values+=,''}
    }
   }
   if($values.Count -eq 1){
    try{$actual=[IO.Path]::GetFullPath(([string]$values[0]).Trim('"')).TrimEnd('\\');if([string]::Equals($actual,$expected,[StringComparison]::OrdinalIgnoreCase)){[Console]::Out.Write('MATCH');exit 0}}catch{}
   }
   break
  }finally{[void][KBrowserNativeArgv]::LocalFree($argv)}
 }
 $current=[int]$process.ParentProcessId
}
[Console]::Out.Write('NO_MATCH');exit 1`;

export async function inspectChromeParent({pid=process.pid,profileDirectory,platform=process.platform,execFileImpl=execFile}={}){
 if(platform!=='win32'||!Number.isInteger(pid)||pid<1||typeof profileDirectory!=='string'||!path.isAbsolute(profileDirectory))return {allowed:false,errorCode:'parent_check_unavailable'};
 const powershell=path.join(process.env.SystemRoot??process.env.WINDIR??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 try{
  const result=await execFileImpl(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',POWERSHELL_PARENT_CHECK],{
   windowsHide:true,timeout:5000,maxBuffer:1024,env:{...process.env,K_BROWSER_TARGET_PID:String(pid),K_BROWSER_EXPECTED_PROFILE:path.resolve(profileDirectory)},
  });
  return result.stdout.trim()==='MATCH'?{allowed:true,errorCode:null}:{allowed:false,errorCode:'parent_mismatch'};
 }catch(error){
  if(typeof error?.stdout==='string'&&error.stdout.trim()==='NO_MATCH')return {allowed:false,errorCode:'parent_mismatch'};
  if(error?.code==='ETIMEDOUT'||(error?.killed===true&&error?.signal==='SIGTERM'))return {allowed:false,errorCode:'parent_timeout'};
  return {allowed:false,errorCode:'parent_check_failed'};
 }
}

export async function isAllowedChromeParent(options={}){
 return (await inspectChromeParent(options)).allowed;
}

async function writeDiagnostic(diagnosticPath,startedAt,{stage,errorCode=null}){
 const elapsedMs=Number(process.hrtime.bigint()-startedAt)/1e6;
 const diagnostic={version:1,timestamp:new Date().toISOString(),stage,errorCode,elapsedMs:Number.isFinite(elapsedMs)?Math.max(0,Math.round(elapsedMs)):0};
 try{
  const info=await stat(path.dirname(diagnosticPath));if(!info.isDirectory())return;
  try{const current=await lstat(diagnosticPath);if(current.isSymbolicLink()||!current.isFile())return;}catch(error){if(error.code!=='ENOENT')return;}
  const temporary=`${diagnosticPath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary,JSON.stringify(diagnostic),{flag:'wx',mode:0o600});
  await rename(temporary,diagnosticPath);
 }catch{}
}

export async function writeDescriptor(config,descriptor,{isClosing=()=>false}={}){
 if(isClosing())return false;
 const info=await stat(path.dirname(config.descriptorPath));if(!info.isDirectory())throw new Error('Descriptor directory is invalid.');
 try{const current=await lstat(config.descriptorPath);if(current.isSymbolicLink()||!current.isFile())throw new Error('Descriptor target is unsafe.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=`${config.descriptorPath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
 await writeFile(temporary,JSON.stringify(descriptor),{flag:'wx',mode:0o600});
 if(isClosing())return false;
 await rename(temporary,config.descriptorPath);return true;
}

export async function startNativeHost({config,stdin=process.stdin,stdout=process.stdout,verifyParent,checkParent=inspectChromeParent,requestTimeoutMs=REQUEST_TIMEOUT_MS,diagnosticPath=DEFAULT_DIAGNOSTIC_PATH,startedAt=process.hrtime.bigint(),writeDescriptorImpl=writeDescriptor}={}){
 const safeConfig=validateHostConfig(config);
 await writeDiagnostic(diagnosticPath,startedAt,{stage:'config_loaded'});
 let parentResult;
 try{
  if(verifyParent)parentResult={allowed:await verifyParent({pid:process.pid,profileDirectory:safeConfig.profileDirectory}),errorCode:'parent_mismatch'};
  else parentResult=await checkParent({pid:process.pid,profileDirectory:safeConfig.profileDirectory});
 }catch{parentResult={allowed:false,errorCode:'parent_check_failed'};}
 if(!parentResult?.allowed){
  await writeDiagnostic(diagnosticPath,startedAt,{stage:'parent_check',errorCode:parentResult?.errorCode??'parent_check_failed'});
  throw new Error('Chrome parent is not the approved profile.');
 }
 const token=randomBytes(32).toString('hex'),pending=new Map(),clients=new Set(),decoder=new NativeMessageDecoder();
 const httpServer=createServer((_req,res)=>res.writeHead(404).end());
 const wsServer=new WebSocketServer({noServer:true,maxPayload:MAX_WEBSOCKET_MESSAGE_BYTES});
 let closing=false,profileId=null,incognitoAllowed=false,registering=false,doneResolve,helloTimer;
 const done=new Promise(resolve=>{doneResolve=resolve;});
 const expectedHostForPort=port=>`127.0.0.1:${port}`;
 const replyToOwner=(ws,message)=>{if(ws.readyState===1)ws.send(JSON.stringify(message));};
 const rejectPendingForSocket=ws=>{for(const [id,item] of pending){if(item.ws===ws){clearTimeout(item.timer);pending.delete(id);}}};
 function receiveOwnerMessage(ws,raw){
  let message;try{message=JSON.parse(raw.toString());}catch{replyToOwner(ws,{id:null,ok:false,error:'Invalid request.'});return;}
  if(message?.type==='status'&&Object.keys(message).sort().join(',')==='id,type'&&typeof message.id==='string'){
   replyToOwner(ws,{id:message.id,ok:!!profileId,profileId,incognitoAllowed});return;
  }
  if(!message||typeof message!=='object'||Array.isArray(message)||Object.keys(message).sort().join(',')!=='id,type,url'||typeof message.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(message.id)||message.type!=='openConnectPage'){
   replyToOwner(ws,{id:typeof message?.id==='string'?message.id:null,ok:false,error:'Unsupported request.'});return;
  }
  let url;try{url=validateConnectUrl(message.url,safeConfig.extensionId);}catch{replyToOwner(ws,{id:message.id,ok:false,error:'Connect URL rejected.'});return;}
  if(!profileId||new URL(url).searchParams.get('mode')==='incognito'&&!incognitoAllowed){replyToOwner(ws,{id:message.id,ok:false,error:'Profile or mode unavailable.'});return;}
  if(pending.has(message.id)){replyToOwner(ws,{id:message.id,ok:false,error:'Request id is already active.'});return;}
  const timer=setTimeout(()=>{const item=pending.get(message.id);if(!item)return;pending.delete(message.id);replyToOwner(item.ws,{id:message.id,ok:false,error:'Extension response timed out.'});},requestTimeoutMs);
  pending.set(message.id,{ws,timer});
  void writeNative({id:message.id,type:'openConnectPage',url}).catch(()=>{const item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);replyToOwner(item.ws,{id:message.id,ok:false,error:'Native channel is unavailable.'});}void stop();});
 }
 async function writeNative(message){
  const frame=encodeNativeMessage(message);
  if(stdout.write(frame))return;
  await new Promise((resolve,reject)=>{stdout.once('drain',resolve);stdout.once('error',reject);});
 }
 function receiveNativeMessage(message){
  if(closing)return;
  if(message?.type==='profileHello'){
   if(profileId||registering||Object.keys(message).sort().join(',')!=='incognitoAllowed,profileId,type'||!/^[a-f0-9]{32}$/.test(message.profileId??'')||typeof message.incognitoAllowed!=='boolean'){void stop();return;}
   clearTimeout(helloTimer);
   registering=true;profileId=message.profileId;incognitoAllowed=message.incognitoAllowed;
   const port=httpServer.address().port;
   const profileConfig={...safeConfig,descriptorPath:`${safeConfig.descriptorPath}.${profileId}.json`};
   void (async()=>{
    const published=await writeDescriptorImpl(profileConfig,{version:2,profileId,incognitoAllowed,endpoint:`ws://127.0.0.1:${port}/connect`,token,pid:process.pid},{isClosing:()=>closing});
    if(!published||closing)return;
    await writeDiagnostic(`${diagnosticPath}.${profileId}.json`,startedAt,{stage:'ready'});
   })().catch(async()=>{if(closing)return;await writeDiagnostic(diagnosticPath,startedAt,{stage:'descriptor_write',errorCode:'descriptor_write_failed'});await stop();});
   return;
  }
  if(!message||typeof message!=='object'||Array.isArray(message)||typeof message.id!=='string'||typeof message.ok!=='boolean')return;
  const item=pending.get(message.id);if(!item)return;
  pending.delete(message.id);clearTimeout(item.timer);
  if(message.ok===true)replyToOwner(item.ws,{id:message.id,ok:true});
  else replyToOwner(item.ws,{id:message.id,ok:false,error:typeof message.error==='string'?message.error.slice(0,512):'Extension rejected the request.'});
 }
 const stop=async()=>{
  if(closing)return done;closing=true;clearTimeout(helloTimer);
  for(const [id,item] of pending){clearTimeout(item.timer);replyToOwner(item.ws,{id,ok:false,error:'Native host disconnected.'});}
  pending.clear();for(const ws of clients)ws.terminate();
  await new Promise(resolve=>{try{wsServer.close(()=>resolve());}catch{resolve();}});
  await new Promise(resolve=>{if(!httpServer.listening)return resolve();httpServer.close(()=>resolve());});
  // Do not write on shutdown: a newer instance may already own this profile's
  // slot. On-demand authenticated status distinguishes a stale slot from live.
  stdin.destroy?.();
  doneResolve();return done;
 };
 httpServer.on('upgrade',(request,socket,head)=>{
  const address=httpServer.address(),expectedHost=expectedHostForPort(address.port);
  if(closing||request.url!=='/connect'||!isAuthorizedUpgrade(request,expectedHost,token)){
   socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;
  }
  wsServer.handleUpgrade(request,socket,head,ws=>{clients.add(ws);wsServer.emit('connection',ws,request);});
 });
 wsServer.on('error',()=>{void stop();});
 wsServer.on('connection',ws=>{
  ws.on('error',()=>{});
  ws.on('message',data=>receiveOwnerMessage(ws,data));
  ws.on('close',()=>{clients.delete(ws);rejectPendingForSocket(ws);});
 });
 let startupStage='server_start';
 try{
  await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve);});
  const address=httpServer.address();if(!address||address.address!=='127.0.0.1')throw new Error('Loopback listener was not established.');
  await writeDiagnostic(diagnosticPath,startedAt,{stage:'awaiting_profile'});
  helloTimer=setTimeout(()=>{void stop();},requestTimeoutMs);
  stdin.on('data',chunk=>{try{for(const message of decoder.push(chunk))receiveNativeMessage(message);}catch{void stop();}});
  stdin.once('end',()=>{void stop();});stdin.once('error',()=>{void stop();});stdout.once('error',()=>{void stop();});
 }catch(error){await writeDiagnostic(diagnosticPath,startedAt,{stage:startupStage,errorCode:startupStage==='descriptor_write'?'descriptor_write_failed':'host_start_failed'});await stop();throw error;}
 return {endpoint:`ws://127.0.0.1:${httpServer.address().port}/connect`,token,pid:process.pid,done,close:stop};
}

async function loadConfig(configPath){
 const config=JSON.parse(await readFile(configPath,'utf8'));return validateHostConfig(config);
}

function isMain(){
 try{return process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;}catch{return false;}
}

if(isMain()){
 try{
  const {configPath}=parseHostArguments(process.argv.slice(2));
  const config=await loadConfig(configPath);
  const host=await startNativeHost({config});
  await host.done;
 }catch{
  process.stderr.write('K browser native host rejected or closed.\n');
  process.exitCode=1;
 }
}
