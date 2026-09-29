// Explicit opt-in: local fake data only; never accepts a personal profile path.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const parentRoot=path.resolve('.runtime/profile-download-probe');
if(!process.argv.includes('--run')){console.log('Use --run. Only new local fake profiles and localhost pages are used.');process.exit(0);}
const child=process.argv.includes('--child');
const channel=process.argv.includes('--chromium')?'chromium':'msedge';
if(channel==='chromium'&&process.env.PLAYWRIGHT_BROWSERS_PATH!==path.resolve('.runtime/playwright-browsers'))throw Error('Use the project-only browser installation.');
if(child){
 const root=path.resolve(process.argv[process.argv.indexOf('--child')+1]);
 if(!root.startsWith(parentRoot+path.sep))throw Error('Not a probe directory.');
 const events=[], record=(type,data={})=>events.push({type,at:new Date().toISOString(),...data});
 const server=createServer((req,res)=>{
  if(req.url==='/download'){res.writeHead(200,{'Content-Type':'text/plain','Content-Disposition':'attachment; filename="harmless.txt"'});if(process.argv.includes('--cancel-seed')&&path.basename(root)==='seed'){res.write('partial fake'.repeat(200));return;}return res.end('K harmless local fixture');}
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>local fake page</title><a href="/download">download</a>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let ctx,passed=false;
 try{
  ctx=await chromium.launchPersistentContext(path.join(root,'profile'),{channel,headless:true});
  record('version',{version:ctx.browser()?.version()});ctx.on('close',()=>record('context-close'));
  const cookies=await ctx.cookies();record('cookie-before',{retained:cookies.some(c=>c.name==='k_fake_login'&&c.value==='fake-persistent-only')});
  await ctx.addCookies([{name:'k_fake_login',value:'fake-persistent-only',domain:'127.0.0.1',path:'/',expires:Math.floor(Date.now()/1000)+86400,httpOnly:true}]);
  const page=ctx.pages()[0],base=`http://127.0.0.1:${server.address().port}`;await page.goto(base);
  if(path.basename(root)==='wait-init')await new Promise(r=>setTimeout(r,5000));
  const pending=page.waitForEvent('download',{timeout:10000});
  await page.goto(base+'/download',{timeout:10000}).catch(e=>record('navigation-download',{message:e.message.split('\n')[0]}));
  const download=await pending;record('download-event');
  if(process.argv.includes('--cancel-seed')&&path.basename(root)==='seed'){
   await download.cancel();record('cancelled',{failure:await download.failure()});passed=true;
  }else{
  await download.saveAs(path.join(root,'saved.txt'));
  const text=await readFile(path.join(root,'saved.txt'),'utf8');await page.goto(base+'/after');
  passed=text==='K harmless local fixture'&&!page.isClosed();record('result',{passed});
  }
 }catch(e){record('error',{message:e.message.split('\n')[0]});}
 finally{await ctx?.close().catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(path.join(root,'result.json'),JSON.stringify({passed,events},null,2));}
 process.exitCode=passed?0:1;
}else{
 const root=path.join(parentRoot,randomUUID());await mkdir(root,{recursive:true});
 const run=async(label)=>{
  const dir=path.join(root,label);await mkdir(dir,{recursive:true});
  const proc=spawn(process.execPath,[fileURLToPath(import.meta.url),'--run','--child',dir,...channel==='chromium'?['--chromium']:[],...process.argv.includes('--cancel-seed')?['--cancel-seed']:[]],{windowsHide:true,env:{...process.env,DEBUG:'pw:browser'}});
  let output='';proc.stdout.on('data',x=>output+=x);proc.stderr.on('data',x=>output+=x);
  const code=await new Promise(r=>proc.once('exit',r));await writeFile(path.join(dir,'console.log'),output);
  const result=JSON.parse(await readFile(path.join(dir,'result.json'),'utf8'));console.log(JSON.stringify({label,code,passed:result.passed,cookie:result.events.find(x=>x.type==='cookie-before')}));return result;
 };
 await run('seed');
 const seed=path.join(root,'seed','profile');
 const variants=process.argv.includes('--all-terminal')?['unchanged','empty-terminal','empty-download-tables']:process.argv.includes('--controls')?['unchanged','sqlite-readonly','sqlite-readwrite','sqlite-transaction','sqlite-delete-zero','unchanged-2','empty-completed','unchanged-3']:process.argv.includes('--cancel-seed')?['unchanged','empty-completed']:process.argv.includes('--wait-init')?['unchanged','wait-init']:process.argv.includes('--repeat')?['unchanged','empty-completed']:process.argv.includes('--narrow')?['unchanged','empty-url-chains','empty-main','empty-slices','empty-completed']:['unchanged','without-history','empty-download-tables'];
 for(const label of variants){
  const profile=path.join(root,label,'profile');
  await cp(seed,profile,{recursive:true,errorOnExist:true,force:false,filter:source=>label!=='without-history'||!/^History(?:-.*)?$/.test(path.basename(source))});
  if(label.startsWith('sqlite-')){
   const db=new DatabaseSync(path.join(profile,'Default','History'),{readOnly:label==='sqlite-readonly'});
   db.prepare('SELECT COUNT(*) FROM downloads').get();
   if(label==='sqlite-transaction')db.exec('BEGIN EXCLUSIVE; COMMIT');
   if(label==='sqlite-delete-zero')db.exec('BEGIN EXCLUSIVE; DELETE FROM downloads WHERE id=-99; COMMIT');
   db.close();
  }
  if(label.startsWith('empty-')){
   const db=new DatabaseSync(path.join(profile,'Default','History'));
   const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'downloads%'").all().map(x=>x.name);
   const counts=tables.map(name=>({name,count:db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n}));
   db.exec('BEGIN IMMEDIATE');
   if(label==='empty-download-tables')for(const name of tables)db.exec(`DELETE FROM "${name}"`);
   if(label==='empty-url-chains')db.exec('DELETE FROM downloads_url_chains');
   if(label==='empty-main')db.exec('DELETE FROM downloads');
   if(label==='empty-slices')db.exec('DELETE FROM downloads_slices');
   if(label==='empty-terminal')db.exec('DELETE FROM downloads_url_chains WHERE id IN (SELECT id FROM downloads WHERE state IN (1,2,3)); DELETE FROM downloads_slices WHERE download_id IN (SELECT id FROM downloads WHERE state IN (1,2,3)); DELETE FROM downloads WHERE state IN (1,2,3)');
   if(label==='empty-completed')db.exec('DELETE FROM downloads_url_chains WHERE id IN (SELECT id FROM downloads WHERE state=1); DELETE FROM downloads_slices WHERE download_id IN (SELECT id FROM downloads WHERE state=1); DELETE FROM downloads WHERE state=1');
   db.exec('COMMIT');db.close();
   await writeFile(path.join(root,label,'changed.json'),JSON.stringify(counts,null,2));
  }
  await run(label);
  if(process.argv.includes('--repeat')&&label==='empty-completed')for(let i=0;i<3;i++){
   const db=new DatabaseSync(path.join(profile,'Default','History'));
   db.exec('BEGIN IMMEDIATE; DELETE FROM downloads_url_chains WHERE id IN (SELECT id FROM downloads WHERE state=1); DELETE FROM downloads_slices WHERE download_id IN (SELECT id FROM downloads WHERE state=1); DELETE FROM downloads WHERE state=1; COMMIT');db.close();
   const result=await run(label);await cp(path.join(root,label,'result.json'),path.join(root,label,`repeat-${i+1}.json`));
   if(!result.passed)throw Error('Repeated cleaned-profile launch failed.');
  }
 }
 console.log(JSON.stringify({evidence:root}));
}

