import {MAX_DOWNLOAD_COPY_BYTES} from '../shared/browser-downloads.mjs';

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
