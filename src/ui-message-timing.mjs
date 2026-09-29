import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const emptyProjection=()=>({version:1,messages:{},tools:{}});
const validThreadId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/u.test(id);

export async function loadUiMessageTiming(root,threadId){
  if(!validThreadId(threadId))return emptyProjection();
  try{
    const record=JSON.parse(await readFile(path.join(root,'.runtime','ui-message-timing',`${threadId}.json`),'utf8'));
    if(record?.version!==1||!record.messages||typeof record.messages!=='object'||!record.tools||typeof record.tools!=='object')return emptyProjection();
    return {version:1,messages:record.messages,tools:record.tools};
  }catch(error){if(error.code==='ENOENT')return emptyProjection();throw error;}
}

export async function saveUiMessageTiming(root,threadId,projection){
  if(!validThreadId(threadId))return;
  const directory=path.join(root,'.runtime','ui-message-timing');
  await mkdir(directory,{recursive:true});
  const target=path.join(directory,`${threadId}.json`);
  const temporary=`${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify({version:1,messages:projection.messages??{},tools:projection.tools??{}}),'utf8');
  await rename(temporary,target);
}

export function turnGroupId(turnId){return typeof turnId==='string'&&turnId?`turn:${turnId}`:undefined;}
