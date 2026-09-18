import test from 'node:test';
import assert from 'node:assert/strict';
import {groupProjectSessions,moveSessionOrder,searchSessions,sortSessions} from '../frontend/project-groups.mjs';

const projects=[{path:'D:\\A',name:'音訊'},{path:'D:\\B',name:'研究'},{path:'D:\\C',name:'已封存工作區',archived:true}];
const sessions=[
  {threadId:'a',workspace:'D:\\A',title:'逐字稿整理',model:'luna',lastOpenedAt:'2026-09-12T00:00:00Z'},
  {threadId:'b',workspace:'D:\\A',title:'錄音檢查',model:'terra',lastOpenedAt:'2026-09-14T00:00:00Z',pinned:true},
  {threadId:'c',workspace:'D:\\B',title:'論文摘要',model:'astra',lastOpenedAt:'2026-09-13T00:00:00Z'},
  {threadId:'d',workspace:'D:\\B',title:'已封存稿',model:'terra',lastOpenedAt:'2026-09-10T00:00:00Z',archived:true},
  {threadId:'e',workspace:'D:\\A',title:'舊音檔',model:'terra',lastOpenedAt:'2026-09-11T00:00:00Z'},
  {threadId:'child',parentThreadId:'a',workspace:'D:\\A',title:'子代理紀錄',model:'flash'},
];

test('conversation search uses title, workspace and model; includes archived and omits children',()=>{
  assert.deepEqual(searchSessions(projects,sessions,'音訊').map(s=>s.threadId),['b','a','e']);
  assert.deepEqual(searchSessions(projects,sessions,'astra').map(s=>s.threadId),['c']);
  assert.deepEqual(searchSessions(projects,sessions,'封存').map(s=>s.threadId),['d']);
  assert.deepEqual(searchSessions(projects,[...sessions,{threadId:'hidden',workspace:'D:\\C',title:'封存工作區中的對話',model:'terra'}],'封存工作區中的對話'),[]);
  assert.deepEqual(searchSessions(projects,sessions,'child'),[]);
  assert.deepEqual(searchSessions(projects,sessions,'').map(s=>s.threadId),[]);
});

test('recent and manual order both keep pinned conversations first in grouped and flat data',()=>{
  assert.deepEqual(groupProjectSessions(projects,sessions,{sort:'recent'}).map(p=>p.sessions.map(s=>s.threadId)),[['b','a','e'],['c']]);
  assert.deepEqual(sortSessions(sessions.filter(s=>!s.parentThreadId),{sort:'manual',order:['a','c','b','d','e']}).map(s=>s.threadId),['b','a','c','d','e']);
});

test('archived projects stay out of normal navigation and pinned projects retain their relative order',()=>{
  assert.deepEqual(groupProjectSessions(projects,sessions).map(p=>p.path),['D:\\A','D:\\B']);
  const pinned=[{path:'D:\\B',name:'研究',pinned:true},{path:'D:\\A',name:'音訊',pinned:true},{path:'D:\\C',name:'封存',archived:true}];
  assert.deepEqual(groupProjectSessions(pinned,sessions).map(p=>p.path),['D:\\B','D:\\A']);
});

test('manual movement swaps only within the visible list and keeps pin order consistent',()=>{
  const all=sessions.filter(s=>!s.parentThreadId&&!s.archived);
  const groups=groupProjectSessions(projects,all,{sort:'manual',order:['b','a','c','e']});
  const moved=moveSessionOrder(['b','a','c','e'],all,groups[0].sessions,'e',-1);
  assert.deepEqual(groupProjectSessions(projects,all,{sort:'manual',order:moved})[0].sessions.map(s=>s.threadId),['b','e','a']);
  const cannotCrossPin=moveSessionOrder(['b','a','c','e'],all,sortSessions(all,{sort:'manual',order:['a','b','c','e']}),'b',-1);
  assert.deepEqual(sortSessions(all,{sort:'manual',order:cannotCrossPin}).map(s=>s.threadId),['b','a','c','e']);
  const flat=sortSessions(all,{sort:'manual',order:['b','a','c','e']});
  assert.deepEqual(sortSessions(all,{sort:'manual',order:moveSessionOrder(['b','a','c','e'],all,flat,'c',-1)}).map(s=>s.threadId),['b','c','a','e']);
});
