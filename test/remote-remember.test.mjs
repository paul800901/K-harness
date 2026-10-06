import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRemoteAccess,remoteKeyHash} from '../src/remote-access.mjs';
const setup=async()=>{await mkdir(path.resolve('.runtime'),{recursive:true});const root=await mkdtemp(path.resolve('.runtime/remote-remember-'));const file=path.join(root,'remote-access.json'),key='fake-test-key',value={enabled:true,origin:'https://private.ts.net:8443',port:54832,login:'owner@example.invalid',keyHash:remoteKeyHash(key)};await writeFile(file,JSON.stringify(value));return {root,file,key,value,store:path.join(root,'remote-sessions.json'),req:cookie=>({socket:{remoteAddress:'127.0.0.1'},headers:{cookie:cookie.split(';')[0],host:'private.ts.net:8443','tailscale-user-login':value.login,origin:value.origin,'x-k-command':'exact-once-command'}})};};
test('remembered phone survives process recreation, persists hashes and command claims before work',async()=>{
 const c=await setup();let access=createRemoteAccess(c.file,c.value);const cookie=await access.login(c.key,c.value),req=c.req(cookie),raw=cookie.split(';')[0].split('=')[1];
 assert.match(cookie,/Secure; HttpOnly; SameSite=Strict; Path=\//);assert(await access.authorized(req));
 await access.acceptCommand(req);let file=await readFile(c.store,'utf8');assert(!file.includes(raw));assert(!file.includes(c.key));assert(file.includes(remoteKeyHash(raw)));
 access=createRemoteAccess(c.file,c.value);assert(await access.authorized(req));await assert.rejects(access.acceptCommand(req),{statusCode:409});
 const next={...req,headers:{...req.headers,'x-k-command':'another-command'}};const both=await Promise.allSettled([access.acceptCommand(next),access.acceptCommand(next)]);assert.equal(both.filter(x=>x.status==='fulfilled').length,1);
 await access.logout(req);access=createRemoteAccess(c.file,c.value);assert.equal(await access.authorized(req),false);
});
test('observed key, identity and disabled config permanently revoke old cookies',async()=>{
 for(const edit of [v=>({...v,keyHash:remoteKeyHash('revoked-key')}),v=>({...v,login:'different@example.invalid'}),v=>({...v,enabled:false})]){
  const c=await setup();const access=createRemoteAccess(c.file,c.value),cookie=await access.login(c.key,c.value),req=c.req(cookie);
  await writeFile(c.file,JSON.stringify(edit(c.value)));assert.equal(await access.authorized(req),false);
  await writeFile(c.file,JSON.stringify(c.value));assert.equal(await createRemoteAccess(c.file,c.value).authorized(req),false);
 }
 const c=await setup(),access=createRemoteAccess(c.file,c.value),req=c.req(await access.login(c.key,c.value));
 const saved=JSON.parse(await readFile(c.store,'utf8'));saved.sessions[0].expires=Date.now()-1000;await writeFile(c.store,JSON.stringify(saved));assert.equal(await createRemoteAccess(c.file,c.value).authorized(req),false);
});
test('active phone renews after a day without storing the bearer token',async()=>{
 const c=await setup();let access=createRemoteAccess(c.file,c.value);const cookie=await access.login(c.key,c.value),req=c.req(cookie);assert.equal(await access.refresh(req),null);
 const saved=JSON.parse(await readFile(c.store,'utf8'));saved.sessions[0].expires-=2*24*60*60*1000;await writeFile(c.store,JSON.stringify(saved));access=createRemoteAccess(c.file,c.value);assert(await access.authorized(req));const refreshed=await access.refresh(req),maxAge=Number(refreshed.match(/Max-Age=(\d+)/)[1]);assert(maxAge>=31535998&&maxAge<=31536000);assert(JSON.parse(await readFile(c.store,'utf8')).sessions[0].expires>saved.sessions[0].expires);
});
test('unreadable storage and failed command persistence fail closed',async()=>{
 const c=await setup();await writeFile(c.store,'broken');const broken=createRemoteAccess(c.file,c.value);await assert.rejects(broken.login(c.key,c.value),/登入紀錄/);await assert.rejects(broken.authorized(c.req('__Host-k_remote='+'a'.repeat(64))),/登入紀錄/);
 const other=await setup(),access=createRemoteAccess(other.file,other.value);const cookie=await access.login(other.key,other.value),req=other.req(cookie);
 // A filesystem failure must not become an accepted command or successful logout.
 const moved=path.join(other.root,'old-sessions.json');const {rename}=await import('node:fs/promises');await rename(other.store,moved);await mkdir(other.store);
 await assert.rejects(access.acceptCommand(req),{statusCode:503});await assert.rejects(access.logout(req),{statusCode:503});assert(await access.authorized(req));
});
