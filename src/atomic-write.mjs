import {mkdir,open,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Persist one complete snapshot. Retry only its replacement, never caller work.
export async function atomicWrite(target,data){
 await mkdir(path.dirname(target),{recursive:true});
 const temporary=`${target}.${randomUUID()}.tmp`;
 const file=await open(temporary,'wx');
 try{await file.writeFile(data);await file.sync();}finally{await file.close();}
 for(let attempt=0;;attempt++){
  try{await rename(temporary,target);return target;}
  catch(error){
   if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=20)throw error;
   await new Promise(resolve=>setTimeout(resolve,Math.min(5*(attempt+1),50)));
  }
 }
}
