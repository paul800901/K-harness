import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerSessionMediaPermissionHandlers,createSubscriptionLoginWindowHandler} from '../src/electron-workbench.mjs';

const appOrigin='http://127.0.0.1:43127';
function fixture(){
 const mainFrame={url:`${appOrigin}/`};
 const owner={mainFrame,getURL:()=>mainFrame.url,isDestroyed:()=>false,isFocused:()=>focused};
 const foreign={mainFrame,getURL:()=>mainFrame.url,isDestroyed:()=>false,isFocused:()=>focused};
 let closing=false,focused=true;
 const handlers=createOwnerSessionMediaPermissionHandlers({ownerWebContents:owner,getAppOrigin:()=>appOrigin,isClosing:()=>closing});
 const details={requestingUrl:`${appOrigin}/`,securityOrigin:appOrigin,isMainFrame:true,mediaTypes:['audio']};
 const request=(webContents=owner,permission='media',requestDetails=details)=>{
  let granted;
  handlers.request(webContents,permission,value=>{granted=value;},requestDetails);
  return granted;
 };
 return {owner,foreign,mainFrame,details,handlers,request,close:()=>{closing=true;},focus:value=>{focused=value;}};
}

test('owner main-frame exact-origin audio-only media is allowed',()=>{
 const f=fixture();
 assert.equal(f.request(),true);
 assert.equal(f.handlers.check(f.owner,'media',appOrigin,{isMainFrame:true,mediaType:'audio',securityOrigin:appOrigin,requestingUrl:`${appOrigin}/`}),true);
});

test('camera, mixed capture, display and unrelated permission requests are denied',()=>{
 const f=fixture();
 assert.equal(f.request(f.owner,'media',{...f.details,mediaTypes:['video']}),false);
 assert.equal(f.request(f.owner,'media',{...f.details,mediaTypes:['audio','video']}),false);
 assert.equal(f.request(f.owner,'display-capture',f.details),false);
 assert.equal(f.handlers.check(f.owner,'media',appOrigin,{isMainFrame:true,mediaType:'video',securityOrigin:appOrigin,requestingUrl:`${appOrigin}/`}),false);
 assert.equal(f.handlers.check(f.owner,'clipboard-sanitized-write',appOrigin,{isMainFrame:true,securityOrigin:appOrigin,requestingUrl:`${appOrigin}/`}),true);
 assert.equal(f.handlers.check(f.owner,'clipboard-read',appOrigin,{isMainFrame:true,securityOrigin:appOrigin,requestingUrl:`${appOrigin}/`}),false);
 let displayResult='not-called';f.handlers.display({securityOrigin:appOrigin,frame:f.owner.mainFrame,videoRequested:true,audioRequested:false,userGesture:true},value=>{displayResult=value;});
 assert.equal(displayResult,null);
});

test('sanitized clipboard writes are allowed only for the focused owner main frame and never grant reads',()=>{
 const f=fixture();
 assert.equal(f.request(f.owner,'clipboard-sanitized-write',{requestingUrl:`${appOrigin}/`,isMainFrame:true}),true);
 assert.equal(f.handlers.check(f.owner,'clipboard-sanitized-write',appOrigin,{isMainFrame:true,requestingUrl:`${appOrigin}/`}),true);
 f.focus(false);
 assert.equal(f.request(f.owner,'clipboard-sanitized-write',{requestingUrl:`${appOrigin}/`,isMainFrame:true}),false);
 f.focus(true);
 assert.equal(f.request(f.owner,'clipboard-read',{requestingUrl:`${appOrigin}/`,isMainFrame:true}),false);
 assert.equal(f.request(f.owner,'clipboard-sanitized-write',{requestingUrl:'http://localhost:43127/',isMainFrame:true}),false);
 assert.equal(f.request(f.owner,'clipboard-sanitized-write',{requestingUrl:`${appOrigin}/frame`,isMainFrame:false}),false);
});

test('foreign webContents, iframe, cross-origin frames and mismatched origins are denied',()=>{
 const f=fixture();
 assert.equal(f.request(f.foreign),false);
 assert.equal(f.request(f.owner,'media',{...f.details,isMainFrame:false}),false);
 assert.equal(f.request(f.owner,'media',{...f.details,isMainFrame:false,requestingUrl:'http://localhost:43127/frame',securityOrigin:'http://localhost:43127'}),false);
 assert.equal(f.request(f.owner,'media',{...f.details,requestingUrl:'http://localhost:43127/'}),false);
 assert.equal(f.handlers.check(f.owner,'media','http://localhost:43127',{isMainFrame:false,mediaType:'audio',securityOrigin:'http://localhost:43127',requestingUrl:'http://localhost:43127/frame'}),false);
 assert.equal(f.handlers.check(f.owner,'media',appOrigin,{isMainFrame:true,mediaType:'audio',securityOrigin:'http://localhost:43127',requestingUrl:`${appOrigin}/`}),false);
});

test('permission handlers fail closed after owner lifecycle closes or URLs become invalid',()=>{
 const f=fixture();
 f.close();
 assert.equal(f.request(),false);
 assert.equal(f.handlers.check(f.owner,'media',appOrigin,{isMainFrame:true,mediaType:'audio',securityOrigin:appOrigin,requestingUrl:`${appOrigin}/`}),false);
 const g=fixture();g.mainFrame.url='about:blank';
 assert.equal(g.request(),false);
 assert.equal(g.handlers.check(g.owner,'media',appOrigin,{isMainFrame:true,mediaType:'audio',securityOrigin:appOrigin,requestingUrl:`${appOrigin}/`}),false);
});

test('official Codex and Claude login links open externally while Electron popups stay denied',()=>{
 const opened=[],handler=createSubscriptionLoginWindowHandler(async url=>{opened.push(url);});
 for(const url of ['https://auth.openai.com/oauth/authorize?state=fixture','https://claude.ai/oauth/authorize?state=fixture','https://claude.com/oauth/authorize?state=fixture']){
  assert.deepEqual(handler({url}),{action:'deny'});
  assert.equal(opened.at(-1),url);
 }
 for(const url of ['https://example.com/oauth/authorize','https://auth.openai.com.evil.example/oauth/authorize','https://user:secret@auth.openai.com/oauth/authorize','file:///C:/Windows/System32/cmd.exe','https://auth.openai.com/','http://auth.openai.com/oauth/authorize'])assert.deepEqual(handler({url}),{action:'deny'});
 assert.equal(opened.length,3);
});
