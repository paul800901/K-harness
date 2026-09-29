import {openCodexHost} from './codex-host.mjs';

// The official runtime owns credentials and its OAuth callback. Only safe status
// and the official authorization URL cross the local UI boundary.
export function createCodexLogin({cwd,executable,hostFactory=openCodexHost}={}){
 let host=null,loginId=null,login={status:'idle'},queue=Promise.resolve(),closed=false;
 const serial=work=>{const next=queue.then(work);queue=next.catch(()=>{});return next;};
 const release=async()=>{const current=host;host=null;loginId=null;await current?.close();};
 const connect=async()=>{
  if(host)return host;
  const current=hostFactory({cwd,executable,onEvent:event=>{
   if(host===current&&event.method==='account/login/completed'&&event.params?.loginId===loginId)
    login={status:event.params.success?'complete':'error'};
  }});
  host=current;
  current.closed?.then(()=>{if(host===current){host=null;loginId=null;if(login.status==='running')login={status:'error'};}});
  await current.request('initialize',{clientInfo:{name:'k_harness_login',version:'0.1.0'}});
  current.notify({method:'initialized',params:{}});
  return current;
 };
 const read=async()=>{
  const {account}=await (await connect()).request('account/read',{refreshToken:false});
  const verified=account?.type==='chatgpt';
  return {available:verified,auth:{loggedIn:!!account,authMethod:verified?'chatgpt':null,planType:verified?account.planType??null:null},...(!verified?{reason:account?'目前不是 ChatGPT 訂閱登入；K 不會改走 API 計費。':'尚未登入 GPT 訂閱，請完成官方登入。'}:{})};
 };
 return {
  status:()=>serial(async()=>{
   try{if(closed)throw new Error();return {...await read(),login:{...login}};}
   catch{return {available:false,reason:'無法讀取 Codex 登入狀態。',login:{...login}};}
   finally{if(login.status!=='running')await release();}
  }),
  start:()=>serial(async()=>{
   try{
    if(closed)throw new Error();
    const status=await read();
    if(status.available||login.status==='running')return {...status,login:{...login}};
    const result=await host.request('account/login/start',{type:'chatgpt'});
    loginId=result.loginId;
    const url=new URL(result.authUrl);
    if(result.type!=='chatgpt'||!loginId||url.protocol!=='https:'||url.hostname!=='auth.openai.com'||url.username||url.password)throw new Error();
    login={status:'running',url:url.href};
    return {...status,login:{...login}};
   }catch{login={status:'error'};return {available:false,login:{...login}};}
   finally{if(login.status!=='running')await release();}
  }),
  cancel:()=>serial(async()=>{
   try{if(host&&loginId)await host.request('account/login/cancel',{loginId});}
   finally{login={status:'idle'};await release();}
   return {login:{...login}};
  }),
  close:()=>serial(async()=>{closed=true;login={status:'idle'};await release();})
 };
}
