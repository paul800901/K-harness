import {lstat,mkdir,open,realpath,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const HOST_MAX_ENTRIES=64;
const HOST_MAX_BYTES=8*1024;
const FILE_MAX_BYTES=256*1024;
const FILE_NAME='codex-host.jsonl';
const LOGS_WRITE_WARNING="Codex couldn't save diagnostic logs to its local database. Use /feedback with logs included before closing Codex, or run `codex doctor` for diagnostics.";
const fileWrites=new Map();
const SQLITE_KINDS=[
  [/\b(?:database is locked|database table is locked|database schema is locked|sqlite_busy|sqlite_locked)\b/iu,'sqlite_busy_or_locked'],
  [/\b(?:database or disk is full|sqlite_full)\b/iu,'sqlite_full'],
  [/\b(?:attempt to write a readonly database|sqlite_readonly)\b/iu,'sqlite_readonly'],
  [/\b(?:disk i\/o error|sqlite_ioerr)\b/iu,'sqlite_io'],
  [/\b(?:unable to open database file|sqlite_cantopen)\b/iu,'sqlite_open_failed'],
];

export function classifyCodexStderrLine(line) {
  for(const [pattern,kind] of SQLITE_KINDS)if(pattern.test(line))return kind;
  if(/\bsqlite\b|\bdatabase\b/iu.test(line)&&/\b(?:error|failed|failure|unable|locked|readonly|full)\b/iu.test(line))return 'sqlite_unknown';
  return null;
}

export function createCodexHostDiagnostics({home,pid,executable}) {
  const codexHome=typeof home==='string'&&home.length?path.resolve(home):null;
  let entries=0,bytes=0,stderrBuffer='',discardLongLine=false,warningRecorded=false;
  const file=codexHome?path.join(codexHome,'k-diagnostics',FILE_NAME):null;
  const base={pid:Number.isInteger(pid)?pid:null,executable:typeof executable==='string'?executable.slice(0,1024):null,codexHome};

  function enqueueWrite(line) {
    // App-server hosts in this process share a serial writer. Other processes
    // using the same CODEX_HOME can still race the bounded read/replace and
    // lose a record; no cross-process lock service is introduced here.
    const previous=fileWrites.get(file)??Promise.resolve();
    const next=previous.then(async()=>{
      try {
        const canonicalHome=await realpath(codexHome);
        if(path.resolve(canonicalHome).toLowerCase()!==codexHome.toLowerCase())return;
        const homeStat=await lstat(codexHome);
        if(!homeStat.isDirectory()||homeStat.isSymbolicLink())return;
        const directory=path.dirname(file);
        await mkdir(directory,{recursive:true});
        const directoryStat=await lstat(directory);
        if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink())return;
        if(path.resolve(await realpath(directory)).toLowerCase()!==path.resolve(directory).toLowerCase())return;
        let existing='';
        try{
          const current=await lstat(file);
          if(current.isSymbolicLink()||!current.isFile()||current.nlink!==1||current.size>FILE_MAX_BYTES)return;
          if(path.resolve(await realpath(file)).toLowerCase()!==path.resolve(file).toLowerCase())return;
          const handle=await open(file,'r');
          try{
            const opened=await handle.stat();
            if(!opened.isFile()||opened.size>FILE_MAX_BYTES||opened.nlink!==1)return;
            const buffer=Buffer.alloc(FILE_MAX_BYTES+1);
            const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
            if(bytesRead>FILE_MAX_BYTES)return;
            existing=buffer.toString('utf8',0,bytesRead);
          }finally{await handle.close();}
        }catch(error){if(error.code!=='ENOENT')return;}
        let contents=existing+line;
        while(Buffer.byteLength(contents)>FILE_MAX_BYTES){
          const nextLine=contents.indexOf('\n');
          if(nextLine<0){contents='';break;}
          contents=contents.slice(nextLine+1);
        }
        const temp=path.join(directory,`.codex-host-${randomUUID()}.tmp`);
        await writeFile(temp,contents,{encoding:'utf8',flag:'wx'});
        await rename(temp,file);
      } catch { /* Diagnostics must never affect the host or its events. */ }
    });
    fileWrites.set(file,next);
    void next.finally(()=>{if(fileWrites.get(file)===next)fileWrites.delete(file);});
    return next;
  }
  function record(kind) {
    const isWarning=kind==='logs_write_warning';
    // Reserve a slot and half the tiny host budget for the one native warning;
    // collateral stderr flooding must not consume its only evidence record.
    if(!file||entries>=(isWarning?HOST_MAX_ENTRIES:HOST_MAX_ENTRIES-1)||isWarning&&warningRecorded)return;
    const value={receivedAt:new Date().toISOString(),...base,nativeVersion:'unknown',sqliteHome:'unknown',sqliteHomeSource:'unknown',kind,evidenceSource:isWarning?'app_server_warning':'stderr_text_match',...(isWarning?{nativeFlushClassification:'unknown'}:{})};
    const line=JSON.stringify(value)+'\n';
    const size=Buffer.byteLength(line);
    if(bytes+size>(isWarning?HOST_MAX_BYTES:HOST_MAX_BYTES/2))return;
    if(isWarning)warningRecorded=true;
    entries++;bytes+=size;
    return enqueueWrite(line);
  }

  function stderr(chunk) {
    const text=Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk);
    for(const char of text){
      if(discardLongLine){if(char==='\n'){discardLongLine=false;stderrBuffer='';}continue;}
      if(char==='\n'){
        const kind=classifyCodexStderrLine(stderrBuffer);
        if(kind)record(kind);
        stderrBuffer='';continue;
      }
      if(stderrBuffer.length>=2048){stderrBuffer='';discardLongLine=true;continue;}
      stderrBuffer+=char;
    }
  }
  function warning(message) {
    const text=message?.params?.message;
    if(message?.method==='warning'&&text===LOGS_WRITE_WARNING)record('logs_write_warning');
  }
  return {stderr,warning,flush:()=>file?fileWrites.get(file)??Promise.resolve():Promise.resolve()};
}
