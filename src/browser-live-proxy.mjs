import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {MAX_DOWNLOAD_COPY_BYTES} from '../shared/browser-downloads.mjs';

// Only the active native session can select an endpoint; HTTP clients never
// supply a host, port, token or filesystem path.
export async function browserLiveRequest(root,state,threadId,route,body,fetchImpl=fetch){
  if(!threadId||threadId!==state.threadId)throw new Error('對話已切換，請重新開啟瀏覽器分頁。');
  const key=state.browserAccess?.sessionKey;
  if(!state.browserAccess?.enabled||!key)return {available:false,mode:'ai',busy:false,error:'此對話尚未啟用瀏覽器。'};
  if(!/^[A-Za-z0-9-]{1,100}$/.test(key))throw new Error('瀏覽器工作識別無效。');
  const dir=path.join(root,'.runtime','browser-profiles',key);
  const file=path.join(dir,'live.json');
  let descriptor;
  try{
    const base=await realpath(root);
    if((await realpath(file)).toLowerCase()!==path.join(base,'.runtime','browser-profiles',key,'live.json').toLowerCase())throw new Error('瀏覽器連線紀錄不能轉向其他路徑。');
    descriptor=JSON.parse(await readFile(file,'utf8'));
  }catch(error){if(error.code==='ENOENT')return {available:false,mode:'ai',busy:false,error:'瀏覽器尚未準備好，請稍後再試。'};throw error;}
  if(!Number.isInteger(descriptor.port)||descriptor.port<1||descriptor.port>65535||!/^[a-f0-9]{64}$/.test(descriptor.token??''))throw new Error('瀏覽器連線不可用。');
  if(!/^\/(state|frame)(\?pageId=[A-Za-z0-9-]+)?$/.test(route)&&!/^\/download\?id=[a-f0-9-]{36}$/.test(route)&&route!=='/action')throw new Error('無效的瀏覽器操作。');
  if(state.threadId!==threadId||state.browserAccess?.sessionKey!==key||!state.browserAccess?.enabled)throw new Error('對話已切換，操作未送出。');
  const response=await fetchImpl(`http://127.0.0.1:${descriptor.port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${descriptor.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
  return consumeBrowserResponse(response,state,threadId,key,route);
}

export async function consumeBrowserResponse(response,state,threadId,key,route){
  if(!response.ok)throw new Error((await response.json()).error??'瀏覽器操作未完成。');
  if(route.startsWith('/download?')){
    const header=response.headers.get('content-disposition')??'';
    const encoded=header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const name=encoded?decodeURIComponent(encoded):'download';
    if(/[\\/\r\n\x00]/.test(name))throw new Error('下載檔名無效。');
    if(Number(response.headers.get('content-length'))>MAX_DOWNLOAD_COPY_BYTES){await response.body?.cancel();throw new Error('檔案超過 64 MiB，無法儲存副本。');}
    const reader=response.body?.getReader(),chunks=[];let total=0;
    if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_DOWNLOAD_COPY_BYTES){await reader.cancel();throw new Error('檔案超過 64 MiB，無法儲存副本。');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
    if(state.threadId!==threadId||state.browserAccess?.sessionKey!==key||!state.browserAccess?.enabled)throw new Error('對話已切換，下載已取消。');
    return {bytes:Buffer.concat(chunks,total),downloadName:name};
  }
  const result=route.startsWith('/frame')?{bytes:Buffer.from(await response.arrayBuffer())}:await response.json();
  if(state.threadId!==threadId||state.browserAccess?.sessionKey!==key||!state.browserAccess?.enabled)throw new Error('對話已切換，結果已捨棄。');
  return result;
}
