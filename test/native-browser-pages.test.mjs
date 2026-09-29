import test from 'node:test';
import assert from 'node:assert/strict';
import {planNativePagePanelChange,reconcileNativePageChange} from '../frontend/native-browser-pages.mjs';

const state={threadId:'thread-A',selectedPageId:'popup-1',pages:[
 {id:'parent-1',title:'Parent',url:'https://example.test/'},
 {id:'popup-1',title:'Sign in',url:'https://example.test/login'},
]};

test('hidden popup notification reconciles to current thread state without forcing panel selection',()=>{
 const change=reconcileNativePageChange({threadId:'thread-A',pageId:'popup-1',title:'stale'},state,'thread-A',{select:false});
 assert.deepEqual(change,{type:'opened',pageId:'popup-1',title:'Sign in',url:'https://example.test/login',select:false});
});

test('a reconciled selected popup may select only the current visible browser panel',()=>{
 const change=reconcileNativePageChange({threadId:'thread-A',pageId:'popup-1'},state,'thread-A',{select:true});
 assert.equal(change.select,true);
});

test('stale page or other-thread events cannot create or close browser tabs',()=>{
 assert.equal(reconcileNativePageChange({threadId:'thread-A',pageId:'gone'},state,'thread-A'),null);
 assert.equal(reconcileNativePageChange({threadId:'thread-B',pageId:'popup-1'},state,'thread-A'),null);
 assert.equal(reconcileNativePageChange({threadId:'thread-A',pageId:'popup-1'},state,'thread-B'),null);
});

test('closed popup is accepted only after authoritative state no longer contains it',()=>{
 assert.equal(reconcileNativePageChange({threadId:'thread-A',pageId:'popup-1',closed:true},state,'thread-A'),null);
 const closed=reconcileNativePageChange({threadId:'thread-A',pageId:'popup-1',closed:true},{...state,selectedPageId:'parent-1',pages:[state.pages[0]]},'thread-A');
 assert.deepEqual(closed,{type:'closed',pageId:'popup-1'});
});

test('first committed nonblank AI navigation opens the browser panel automatically',()=>{
 const change=reconcileNativePageChange({threadId:'thread-A',pageId:'parent-1',reason:'navigate'},{...state,selectedPageId:'parent-1'},'thread-A',{select:true});
 assert.deepEqual(planNativePagePanelChange(change,{reason:'navigate'},{panelTabs:['artifacts'],panel:'artifacts',inspector:false}),{
 type:'opened',pageId:'parent-1',title:'Parent',url:'https://example.test/',select:true,openInspector:true,
 });
 assert.equal(planNativePagePanelChange({...change,select:false},{reason:'navigate'},{panelTabs:['artifacts'],panel:'artifacts',inspector:false}).select,true,'First owned navigation opens even before the backend selection catches up');
});

test('blank page and a user-dismissed same page never auto-reopen the panel',()=>{
 const blank={type:'opened',pageId:'blank',url:'about:blank',select:true};
 assert.equal(planNativePagePanelChange(blank,{reason:'navigate'}),null);
 const dismissed={type:'opened',pageId:'parent-1',url:'https://example.test/',select:true};
 assert.equal(planNativePagePanelChange(dismissed,{reason:'navigate'},{dismissed:true}),null);
});

test('new popup creates a visible entry without taking over a non-browser panel',()=>{
 const popup={type:'opened',pageId:'popup-2',title:'Popup',url:'https://example.test/popup',select:true};
 assert.deepEqual(planNativePagePanelChange(popup,{reason:'popup-open'},{panelTabs:['artifacts'],panel:'artifacts',inspector:true}),{
  ...popup,select:false,openInspector:true,
 });
});
