import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';

// Observe a real completed replacement, without polling/holding its destination open.
// These tests run sequentially in their file; each test restores the built-in binding.
export function observeAtomicWrite(t,target,matches){
 let resolve,reject;
 const completed=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const timer=setTimeout(()=>reject(new Error(`Expected atomic write did not finish: ${target}`)),5000);
 const original=fs.rename;
 const mock=t.mock.method(fs,'rename',async(from,to)=>{
  const expected=to===target&&matches(JSON.parse(await fs.readFile(from,'utf8')));
  const result=await original(from,to);
  if(expected){clearTimeout(timer);resolve();}
  return result;
 });
 syncBuiltinESMExports();
 t.after(()=>{clearTimeout(timer);mock.mock.restore();syncBuiltinESMExports();});
 return completed;
}
