import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {addProject,listProjects,updateProject} from '../src/projects.mjs';
import {groupProjectSessions} from '../frontend/project-groups.mjs';
import {startDesktop} from '../src/desktop-server.mjs';

async function fixture(){
 const base=fileURLToPath(new URL('../.runtime/tests/',import.meta.url));await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'projects-'));
 const alpha=path.join(root,'alpha'),beta=path.join(root,'beta');await mkdir(alpha);await mkdir(beta);
 return {root,alpha,beta};
}
test('projects persist without conversations; add is idempotent and does not scan or alter contents',async()=>{
 const {root,alpha,beta}=await fixture();await writeFile(path.join(alpha,'keep.txt'),'unchanged');
 await Promise.all([addProject(root,alpha),addProject(root,beta),addProject(root,alpha)]);
 const listed=(await listProjects(root)).projects.map(p=>p.path);
 assert.equal(listed[0],root);
 assert.deepEqual([...listed].sort(),[root,alpha,beta].sort());
 assert.equal(await readFile(path.join(alpha,'keep.txt'),'utf8'),'unchanged');
 assert.deepEqual(JSON.parse(await readFile(path.join(root,'.runtime/projects.json'),'utf8')),listed.slice(1));
 await assert.rejects(addProject(root,path.parse(root).root),/根目錄/);
});
test('saved conversations seed projects even when their directory is temporarily unavailable',async()=>{
 const {root}=await fixture();const gone=path.join(root,'unavailable');
 const list=await listProjects(root,[{workspace:gone},{workspace:gone}]);
 assert.deepEqual(list.projects.map(p=>p.path),[root,gone]);
});

test('project rename, pin and archive persist without renaming folders or changing chats',async()=>{
 const {root,alpha,beta}=await fixture();
 const sessions=[{threadId:'keep',workspace:alpha,archived:false}];
 await writeFile(path.join(alpha,'keep.txt'),'preserved');
 await Promise.all([updateProject(root,{path:alpha,name:'新名稱'},sessions),updateProject(root,{path:alpha,pinned:true},sessions),addProject(root,beta)]);
 await updateProject(root,{path:alpha,archived:true},sessions);
 let saved=(await listProjects(root,sessions)).projects.find(p=>p.path===alpha);
 assert.equal(saved.name,'新名稱');assert.equal(saved.pinned,true);assert.equal(saved.archived,true);
 assert.equal(sessions[0].archived,false);assert.equal(await readFile(path.join(alpha,'keep.txt'),'utf8'),'preserved');
 await updateProject(root,{path:alpha,archived:false},sessions);
 saved=(await listProjects(root,sessions)).projects.find(p=>p.path===alpha);
 assert.equal(saved.archived,false);assert.equal(saved.name,'新名稱');assert.equal(saved.pinned,true);
 await assert.rejects(updateProject(root,{path:alpha,name:' '}),/名稱/);
 await assert.rejects(updateProject(root,{path:alpha,archived:'yes'}),/狀態/);
 await assert.rejects(updateProject(root,{path:path.join(root,'unknown'),pinned:true}),/找不到/);
});
test('unreadable registry fails visibly and is never overwritten',async()=>{
 const {root,alpha}=await fixture();await mkdir(path.join(root,'.runtime'));const target=path.join(root,'.runtime/projects.json');
 await writeFile(target,'invalid data');await assert.rejects(addProject(root,alpha),/原檔已保留/);
 assert.equal(await readFile(target,'utf8'),'invalid data');
});
test('sidebar groups by workspace not model; search and archive respect ownership and exclude children',()=>{
 const projects=[{path:'D:\\Mods',name:'模組'},{path:'D:\\Audio',name:'錄音'}];
 const sessions=[
  {threadId:'a',workspace:'d:/mods/',title:'改造',model:'terra',archived:false},
  {threadId:'b',workspace:'D:\\Mods',title:'驗收',model:'astra',archived:false,pinned:true},
  {threadId:'c',workspace:'D:\\Audio',title:'逐字稿',model:'luna',archived:false},
  {threadId:'d',workspace:'D:\\Mods',title:'舊稿',model:'terra',archived:true},
  {threadId:'e',parentThreadId:'a',workspace:'D:\\Mods',title:'child',model:'flash',archived:false},
 ];
 const groups=groupProjectSessions(projects,sessions);
 assert.deepEqual(groups.map(p=>p.sessions.map(s=>s.threadId)),[['b','a'],['c']]);
 assert.deepEqual(groupProjectSessions(projects,sessions,{query:'luna'}).map(p=>p.name),['錄音']);
 assert.deepEqual(groupProjectSessions(projects,sessions,{query:'模組'})[0].sessions.map(s=>s.threadId),['b','a']);
 assert.deepEqual(groupProjectSessions(projects,sessions,{archived:true})[0].sessions.map(s=>s.threadId),['d']);
});
test('project routes require same-origin local authority; adding does not switch active conversation',async()=>{
 const {root,alpha}=await fixture();let switches=0;
 const state={threadId:'original',workspace:root};
 const app=await startDesktop({root,port:0,controllerFactory:()=>({state,sessions:async()=>({sessions:[]}),selectWorkspace:async()=>{switches++;},close:async()=>{}})});
 try {
  const landing=await fetch(app.createLaunchUrl(),{redirect:'manual'});const cookie=landing.headers.get('set-cookie').split(';')[0];await landing.text();
  const data={method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:JSON.stringify({path:alpha})};
  assert.equal((await fetch(app.origin+'/api/projects',data)).status,403);
  const add=await fetch(app.origin+'/api/projects',{...data,headers:{...data.headers,cookie,origin:app.origin}});assert.equal(add.status,200);
  const list=await fetch(app.origin+'/api/projects',{headers:{cookie}});assert.equal((await list.json()).projects.length,2);
  assert.equal(switches,0);assert.equal(state.threadId,'original');
  const edit={...data,body:JSON.stringify({path:alpha,name:'顯示名稱',pinned:true,archived:true})};
  assert.equal((await fetch(app.origin+'/api/projects/metadata',edit)).status,403);
  assert.equal((await fetch(app.origin+'/api/projects/metadata',{...edit,headers:{...edit.headers,cookie,origin:'https://example.com'}})).status,403);
  const changed=await fetch(app.origin+'/api/projects/metadata',{...edit,headers:{...edit.headers,cookie,origin:app.origin}});
  assert.equal(changed.status,200);assert.equal((await changed.json()).name,'顯示名稱');
  assert.equal(switches,0);assert.equal(state.threadId,'original');
 }finally{await app.close();}
});
