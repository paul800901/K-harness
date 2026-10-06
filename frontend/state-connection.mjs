// Every new SSE connection already starts with the server's current snapshot.
// Resume only this read stream, never a command or saved prompt.
export function connectState({onEvent,onOnline,pauseWhenHidden=false,EventSourceImpl=EventSource,documentImpl=document,windowImpl=window}){
 let stream=null,disposed=false,hasSnapshot=false;
 const close=()=>{if(stream){stream.onmessage=null;stream.onerror=null;stream.close();stream=null;}hasSnapshot=false;onOnline(false);};
 const connect=()=>{
  if(disposed||pauseWhenHidden&&documentImpl.visibilityState==='hidden')return;
  close();const current=new EventSourceImpl('/api/events');stream=current;
  current.onmessage=e=>{
   if(current!==stream)return;
   try{const event=JSON.parse(e.data);if(event.type==='snapshot')hasSnapshot=true;if(!hasSnapshot)return;onEvent(event);onOnline(true);}catch{onOnline(false);}
  };
  current.onerror=()=>{if(current===stream){hasSnapshot=false;onOnline(false);}};
 };
 const visibility=()=>{if(pauseWhenHidden)documentImpl.visibilityState==='hidden'?close():connect();};
 const pageshow=event=>{if(event.persisted)connect();};
 documentImpl.addEventListener('visibilitychange',visibility);
 windowImpl.addEventListener('online',connect);windowImpl.addEventListener('offline',close);windowImpl.addEventListener('pageshow',pageshow);windowImpl.addEventListener('pagehide',close);
 connect();
 return()=>{disposed=true;documentImpl.removeEventListener('visibilitychange',visibility);windowImpl.removeEventListener('online',connect);windowImpl.removeEventListener('offline',close);windowImpl.removeEventListener('pageshow',pageshow);windowImpl.removeEventListener('pagehide',close);close();};
}
