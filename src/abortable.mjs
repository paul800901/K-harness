// Wait for native initialization without accepting a late result after cancellation.
export function abortable(promise,signal){
 if(!signal)return promise;
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);signal.aborted?reject(signal.reason):resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
