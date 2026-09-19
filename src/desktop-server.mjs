import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createDesktopController} from './desktop-controller.mjs';
import {listProjects,addProject,updateProject} from './projects.mjs';
import {pickWorkspaceDirectory} from './workspace-picker.mjs';
import {validateWorkspace} from './workspaces.mjs';

export async function startDesktop({root,executable,port=47831,controllerFactory=createDesktopController,pickWorkspace=pickWorkspaceDirectory}){
 const cookie=randomBytes(32).toString('hex'),clients=new Set();let scheduled;
 let pickerAbort=null;
 const controller=controllerFactory({root,executable,onChange(){
  if(!scheduled)scheduled=setTimeout(()=>{scheduled=null;for(const client of clients)client.write(`data: ${JSON.stringify(controller.state)}\n\n`);},60);
 }});
 const assets=new Map([['/',['index.html','text/html']],['/app.js',['app.js','text/javascript']],['/style.css',['style.css','text/css']],['/icon.svg',['icon.svg','image/svg+xml']]]);
 for(const name of ['base.css','design-platform.css','scrollbar.css'])assets.set(`/dsh/${name}`,[`dsh/${name}`,'text/css']);
 assets.set('/dsh-layout.css',['dsh-layout.css','text/css']);
 let origin;
 const server=http.createServer(async(req,res)=>{
  const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   if(req.headers.host!==new URL(origin).host)return json(403,{error:'Invalid host'});
   const url=new URL(req.url,origin);
   if(req.method==='GET'&&url.pathname==='/health')return json(200,{app:'k-harness-desktop',version:1,workspace:root});
   if(req.method==='GET'&&(url.pathname==='/'||/^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname))){
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':name.endsWith('.jpg')?'image/jpeg':'application/octet-stream';
    if(url.pathname==='/')res.setHeader('Set-Cookie',`k_session=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
    const body=await readFile(new URL(`../dist-ui/${name}`,import.meta.url));res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`});return res.end(body);
   }
   if(req.method==='GET'&&assets.has(url.pathname)){
    const [name,type]=assets.get(url.pathname);
    if(url.pathname==='/')res.setHeader('Set-Cookie',`k_session=${cookie}; HttpOnly; SameSite=Strict; Path=/`);
    const body=await readFile(new URL(`../web/${name}`,import.meta.url));res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`});return res.end(body);
   }
   if(!req.headers.cookie?.split(';').some(c=>c.trim()===`k_session=${cookie}`))return json(403,{error:'請從桌面啟動 K。'});
   if(req.headers.origin&&req.headers.origin!==origin)return json(403,{error:'Cross-origin request denied'});
   if(req.method==='GET'&&url.pathname==='/api/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write(`data: ${JSON.stringify(controller.state)}\n\n`);clients.add(res);
    const heartbeat=setInterval(()=>res.write(': alive\n\n'),20000);req.on('close',()=>{clearInterval(heartbeat);clients.delete(res);});return;
   }
   if(req.method==='GET'&&url.pathname==='/api/sessions')return json(200,await controller.sessions());
   if(req.method==='GET'&&url.pathname==='/api/projects')return json(200,await listProjects(root,(await controller.sessions()).sessions));
   if(req.method==='GET'&&url.pathname==='/api/models')return json(200,await controller.models());
   if(req.method==='GET'&&url.pathname==='/api/state')return json(200,controller.state);
   if(req.method==='GET'&&url.pathname==='/api/usage')return json(200,await controller.usage(url.searchParams.get('refresh')==='1'));
   if(req.method==='GET'&&url.pathname==='/api/directories')return json(200,await controller.directories(url.searchParams.get('path')??undefined));
   if(req.method==='GET'&&['/api/artifact','/api/attachment'].includes(url.pathname)){
    const file=url.pathname==='/api/artifact'?await controller.artifact(url.searchParams.get('path')):await controller.attachmentFile(url.searchParams.get('id'));
    if(url.searchParams.get('download')==='1'){res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.setHeader('Content-Type',file.contentType);return res.end(file.bytes);}
    if(file.contentType.startsWith('image/')){res.setHeader('Content-Type',file.contentType);return res.end(file.bytes);}
    return json(200,{name:file.name,isText:file.isText,text:file.isText?file.bytes.subarray(0,262144).toString('utf8'):null,truncated:file.bytes.length>262144,size:file.bytes.length});
   }
   if(req.method!=='POST'||req.headers['x-k-request']!=='1'||!req.headers['content-type']?.startsWith('application/json'))return json(403,{error:'Explicit local request required'});
   let raw='';const maxBody=url.pathname==='/api/upload'?12*1024*1024:65536;for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>maxBody)throw new Error('請求過大。');}const data=JSON.parse(raw||'{}');
   if(url.pathname==='/api/pick-workspace'){
    if(pickerAbort)throw new Error('資料夾選擇視窗已開啟，請先完成或取消。');
    if(data.path!==undefined&&typeof data.path!=='string')throw new Error('資料夾路徑無效。');
    const abort=new AbortController();pickerAbort=abort;
    const disconnected=()=>abort.abort();res.once('close',disconnected);
    try {
     const picked=await pickWorkspace({path:data.path??controller.state.workspace??root,signal:abort.signal});
     if(abort.signal.aborted)return;
     if(picked.cancelled)return json(200,{cancelled:true});
     return json(200,{cancelled:false,path:await validateWorkspace(picked.path)});
    }finally{res.off('close',disconnected);if(pickerAbort===abort)pickerAbort=null;}
   }
   if(url.pathname==='/api/projects')return json(200,await addProject(root,data.path));
   if(url.pathname==='/api/projects/metadata')return json(200,await updateProject(root,data,(await controller.sessions()).sessions));
   const routes={'/api/open':'open','/api/send':'send','/api/steer':'steer','/api/goal':'goal','/api/compact':'compact','/api/stop':'stop','/api/answer':'answer','/api/workers':'workers','/api/upload':'upload','/api/metadata':'metadata','/api/workspace':'selectWorkspace','/api/model':'selectModel'};
   if(routes[url.pathname])return json(200,await controller[routes[url.pathname]](...(['/api/workers','/api/stop','/api/compact'].includes(url.pathname)?[]:[data])));
   if(url.pathname==='/api/shutdown'){pickerAbort?.abort();await controller.close();json(200,{closed:true});setTimeout(()=>{for(const c of clients)c.end();server.close();},100);return;}
   json(404,{error:'Not found'});
  }catch(e){if(!res.headersSent)json(400,{error:e.message});else res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{origin=`http://127.0.0.1:${server.address().port}`;resolve();});});
 return {origin,controller,async close(){pickerAbort?.abort();await controller.close();clearTimeout(scheduled);for(const c of clients)c.end();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../',import.meta.url));const executable=process.argv[2];if(!executable)throw new Error('Installed Codex executable required.');
 const app=await startDesktop({root,executable});console.log(`K desktop ready: ${app.origin}`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close());
}
