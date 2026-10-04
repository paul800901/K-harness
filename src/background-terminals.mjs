import {setTimeout as delay} from 'node:timers/promises';

export async function listTerminals(host,threadId){
 const result=[],seen=new Set();let cursor;
 do{
  const page=await host.request('thread/backgroundTerminals/list',{threadId,limit:100,...cursor?{cursor}:{}});
  if(!Array.isArray(page.data))throw new Error('無法確認背景命令清單。');
  result.push(...page.data);cursor=page.nextCursor;
  if(cursor&&seen.has(cursor))throw new Error('背景命令清單未完成。');
  if(cursor)seen.add(cursor);
 }while(cursor);
 return result;
}

export async function stopThreadTerminals(host,threadId){
 const before=await listTerminals(host,threadId);
 if(!before.length)return [];
 await host.request('thread/backgroundTerminals/clean',{threadId});
 // Cleanup acknowledges the termination request before the OS process exits.
 // Read back its disappearance; never resend the command or cleanup request.
 for(let check=0;check<=20;check++){
  if(!(await listTerminals(host,threadId)).length)return before;
  if(check<20)await delay(100);
 }
 throw new Error('背景命令尚未確認停止。');
}
