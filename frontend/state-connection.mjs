// Every new SSE connection already starts with the server's current snapshot.
// Resume only this read stream, never a command or saved prompt.
// EventSource hides HTTP status. Reuse a small existing read route to distinguish
// an expired login from a lost network, without downloading the entire history.
export async function remoteLoginRequired(fetchImpl=fetch){
 try{
  const response=await fetchImpl('/api/sessions',{signal:AbortSignal.timeout(5000)});
  if(response.status!==403)return false;
  return (await response.json()).code==='K_REMOTE_AUTH_REQUIRED';
 }catch{return false;}
}

export function connectState({onEvent,onOnline,checkAccess,onLoginRequired=()=>{},onConnecting=()=>{},pauseWhenHidden=false,EventSourceImpl=EventSource,documentImpl=document,windowImpl=window}){
 let stream=null,disposed=false,hasSnapshot=false,accessCheck=0;
 const close=()=>{accessCheck++;if(stream){stream.onmessage=null;stream.onerror=null;stream.onopen=null;stream.close();stream=null;}hasSnapshot=false;onOnline(false);onConnecting(false);};
 const connect=()=>{
  if(disposed||pauseWhenHidden&&documentImpl.visibilityState==='hidden')return;
  close();const current=new EventSourceImpl('/api/events');stream=current;onConnecting(true);
  current.onopen=()=>{if(current===stream)onConnecting(true);};
  current.onmessage=e=>{
   if(current!==stream)return;
   try{const event=JSON.parse(e.data);if(event.type==='snapshot'){hasSnapshot=true;accessCheck++;onLoginRequired(false);}if(!hasSnapshot)return;onEvent(event);onConnecting(false);onOnline(true);}catch{onConnecting(false);onOnline(false);}
  };
  current.onerror=()=>{
   if(current!==stream)return;
   hasSnapshot=false;onOnline(false);onConnecting(false);
   if(checkAccess){const check=++accessCheck;Promise.resolve().then(checkAccess).then(required=>{if(current===stream&&!hasSnapshot&&check===accessCheck)onLoginRequired(required);}).catch(()=>{});}
  };
 };
 const visibility=()=>{if(pauseWhenHidden)documentImpl.visibilityState==='hidden'?close():connect();};
 const pageshow=event=>{if(event.persisted)connect();};
 documentImpl.addEventListener('visibilitychange',visibility);
 windowImpl.addEventListener('online',connect);windowImpl.addEventListener('offline',close);windowImpl.addEventListener('pageshow',pageshow);windowImpl.addEventListener('pagehide',close);
 connect();
 return()=>{disposed=true;documentImpl.removeEventListener('visibilitychange',visibility);windowImpl.removeEventListener('online',connect);windowImpl.removeEventListener('offline',close);windowImpl.removeEventListener('pageshow',pageshow);windowImpl.removeEventListener('pagehide',close);close();};
}
