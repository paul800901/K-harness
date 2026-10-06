export function uploadAttachment(file,threadId,{signal,onProgress=()=>{}}={}){
 if(!file||typeof file.name!=='string'||!threadId) return Promise.reject(new Error('附件資料不完整。'));
 if(signal?.aborted)return Promise.reject(new DOMException('已取消附件上傳。','AbortError'));
 return new Promise((resolve,reject)=>{
  const request=new XMLHttpRequest();let settled=false;
  const finish=(fn,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);fn(value);};
  const abort=()=>request.abort();
  request.open('POST','/api/upload');
  request.setRequestHeader('Content-Type','application/octet-stream');
  request.setRequestHeader('X-K-Request','1');
  request.setRequestHeader('X-K-Command',crypto.randomUUID());
  request.setRequestHeader('X-K-Thread-Id',threadId);
  request.setRequestHeader('X-K-File-Name',encodeURIComponent(file.name));
  request.upload.onprogress=event=>onProgress({loaded:event.loaded,total:event.total,lengthComputable:event.lengthComputable});
  request.onerror=()=>finish(reject,new Error('附件上傳連線失敗。'));
  request.onabort=()=>finish(reject,new DOMException('已取消附件上傳。','AbortError'));
  request.onload=()=>{
   let result;try{result=JSON.parse(request.responseText||'{}');}catch{finish(reject,new Error('附件上傳回應無法讀取。'));return;}
   if(request.status<200||request.status>=300){finish(reject,new Error(result.error||`附件上傳失敗（${request.status}）。`));return;}
   finish(resolve,result);
  };
  signal?.addEventListener('abort',abort,{once:true});
  request.send(file);
 });
}
