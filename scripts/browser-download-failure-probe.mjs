// Local fake downloads only. No model turn, production switch or browser safety override.
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createBrowserLiveSession} from '../src/browser-live-session.mjs';
import {chromium} from 'playwright';

if(!process.argv.includes('--run')){console.log('Use --run for an isolated Edge / K service download-failure probe.');process.exit(0);}
const root=path.resolve('.runtime/download-failure-probe',randomUUID());
const useChromium=process.argv.includes('--chromium');
const stableDownloads=process.argv.includes('--stable-downloads');
if(useChromium&&process.env.PLAYWRIGHT_BROWSERS_PATH!==path.resolve('.runtime/playwright-browsers'))throw new Error('Chromium probe requires the project-only PLAYWRIGHT_BROWSERS_PATH.');
const profile=useChromium?path.resolve(stableDownloads?'.runtime/chromium-stable-download-fixture/profile':'.runtime/chromium-download-fixture/profile'):process.argv.includes('--previous-fixture')?path.resolve('.runtime/browser-live-ui/.runtime/browser-profiles/demo'):path.join(root,'profile');await mkdir(profile,{recursive:true});
const events=[];const record=(event,data={})=>events.push({at:new Date().toISOString(),event,...data});
const server=createServer((req,res)=>{
 if(req.url.startsWith('/download')){const ext=new URL(req.url,'http://local').searchParams.get('ext')||'txt';res.writeHead(200,{'Content-Type':'text/plain','Content-Disposition':`attachment; filename="fake.${['exe','cmd','txt'].includes(ext)?ext:'txt'}"`});if(req.url.includes('cancel=1')){res.write('K partial fake download'.repeat(100));return;}return res.end('K harmless download fixture');}
 res.setHeader('Content-Type','text/html');res.end('<title>Local fixture</title><p>Download failure fixture</p>');
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const live=await createBrowserLiveSession(profile,{downloadDirectory:path.join(root,'output','downloads'),...(useChromium?{launchContext:(directory,viewport)=>chromium.launchPersistentContext(directory,{channel:'chromium',headless:true,viewport,...(stableDownloads?{downloadsPath:path.join(path.dirname(profile),'raw-downloads')}:{})})}:{})});
const descriptor=JSON.parse(await readFile(live.descriptorPath,'utf8'));
const api=async(type,extra={})=>{const r=await fetch(`http://127.0.0.1:${descriptor.port}/action`,{signal:AbortSignal.timeout(10000),method:'POST',headers:{Authorization:`Bearer ${descriptor.token}`,'Content-Type':'application/json'},body:JSON.stringify({type,...extra})});const body=await r.json();record('action',{type,status:r.status,body});return body;};
let passed=false;
try{
 const ctx=await live.contextGetter();ctx.on('close',()=>record('context-close'));ctx.browser()?.on('disconnected',()=>record('browser-disconnected'));
 await api('takeover');const p=ctx.pages()[0];p.on('crash',()=>record('page-crash'));p.on('close',()=>record('page-close'));
 p.on('download',d=>{record('download-start',{name:d.suggestedFilename()});if(d.url().includes('cancel=1'))void d.cancel();d.failure().then(error=>record('download-end',{name:d.suggestedFilename(),error}));});
 await api('navigate',{url:base});
 // Exercise K's actual service route. Navigating to an attachment can report ERR_ABORTED;
 // that response must not make the context unusable or disable subsequent navigation.
 for(const ext of ['exe','cmd','txt']){
  await api('navigate',{url:`${base}/download?ext=${ext}`});
  for(let i=0;i<100;i++){const state=await live.getState();if(state.downloads.length&&state.downloads.at(-1).status!=='downloading')break;await new Promise(r=>setTimeout(r,100));}
  record('after-download',{ext,state:await live.getState()});
  await api('navigate',{url:`${base}/after-${ext}`});
 }
 await api('navigate',{url:base+'/download?ext=exe&cancel=1'});
 for(let i=0;i<100;i++){if((await live.getState()).downloads.at(-1)?.status==='failed')break;await new Promise(r=>setTimeout(r,100));}
 await api('navigate',{url:base+'/after-cancelled'});
 const state=await live.getState();passed=state.available&&!state.busy&&state.url===`${base}/after-cancelled`&&state.downloads.length===4&&state.downloads.at(-1).status==='failed';
 record('result',{passed,state});
}catch(e){record('error',{message:e.message});}
finally{record('cleanup-start');await live.close();server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(path.join(root,'evidence.json'),JSON.stringify({passed,events},null,2));}
console.log(JSON.stringify({passed,evidence:path.join(root,'evidence.json')},null,2));if(!passed)process.exitCode=1;
