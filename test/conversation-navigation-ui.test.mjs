import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const main=await readFile(new URL('../frontend/main.jsx',import.meta.url),'utf8');
const sidebar=await readFile(new URL('../frontend/project-sidebar.jsx',import.meta.url),'utf8');
const style=await readFile(new URL('../frontend/style.css',import.meta.url),'utf8');
const queued=await readFile(new URL('../frontend/queued-messages.jsx',import.meta.url),'utf8');

test('chat grid children and message scroll area cannot intrude outside the main track',()=>{
  assert.match(style,/\.app>main\{grid-column:2;min-width:0;width:100%\}/);
  assert.match(style,/\.thread,\.viewport-region,\.viewport,\.message-column,\.assistant-message,\.assistant-body,\.composer-area\{min-width:0;max-width:100%\}/);
});

test('late send completion clears only the submitted draft and keeps failed hidden-room input recoverable',()=>{
  assert.match(main,/sessionStorage\.getItem\([^)]+\)\?\.trim\(\)===text\.trim\(\)/);
  assert.match(main,/if\(!sessionStorage\.getItem\([^)]+\)&&raw\)sessionStorage\.setItem\(/);
  assert.match(main,/setUploads\(current=>current\.filter\(item=>!uploads\.includes\(item\)\)\)/);
});

test('chat actions are scoped to the rendered thread',()=>{
  assert.match(main,/const threadId=state\.threadId;\s*const threadApi=\(route,data=\{\}\)=>api\(route,\{\.\.\.data,threadId\}\);/);
  for(const route of ['send','stop'])assert.ok(main.includes(`threadApi('${route}'`),`${route} should use the captured thread API`);
  assert.match(main,/<QueuedMessages state=\{state\} action=\{action\} request=\{threadApi\}/);
  assert.match(queued,/request\('queue',\{id:item.id,action:operation/);
  assert.match(main,/request\('answer',\{id:q\.id/);
  assert.match(main,/request=\{threadApi\}/);
  assert.match(main,/setModal\(\{type:'branch',threadId:state\.threadId/);
  assert.match(main,/api\('fork',\{\.\.\.selection,threadId:modal\.threadId\}\)/);
});

test('new conversations open directly in the selected workspace and agent activity does not lock navigation',()=>{
  // Actual workspace selection and cancellation are exercised by model-picker-ui-probe.mjs.
  assert.match(main,/modal\?\.type==='new'.*<select aria-label="新對話工作區"/s);
  assert.match(main,/modal\?\.type==='new'.*projects\.filter\(p=>!p\.archived\)\.map\(p=>/s);
  assert.match(main,/const archivedProjectRows=projects\.filter\(project=>project\.archived\)/,'archived workspace restoration remains available separately');
  assert.doesNotMatch(main,/await api\('workspace',\{path:modal\.path\}\)/);
  assert.match(main,/const disabled=busy\|\|state\.status==='connecting'\|\|!online/);
  assert.doesNotMatch(main,/const disabled=busy\|\|state\.busy/);
  assert.doesNotMatch(main,/切換對話會移除尚未送出的附件選取/);
});

test('archiving the selected workspace returns the visible view home without touching other workspace conversations',()=>{
  assert.match(main,/const updateProjectMetadata=data=>action\(async\(\)=>\{await projectMetadata\(data\);if\(data\.archived===true&&state\.threadId&&sameWorkspace\(data\.path,state\.workspace\)\)await api\('workspace',\{path:state\.workspace\}\);\}\);/);
  assert.match(main,/onProjectMetadata=\{updateProjectMetadata\}/);
  assert.match(main,/await api\('workspace',\{path:state\.workspace\}\)/,'workspace selection resets only the active view; the controller keeps the prior room registered');
});

test('attachments are stored per thread and sidebar shows human-readable activity',()=>{
  assert.ok(main.includes("uploadsByThread[state.threadId??'']"));
  assert.match(main,/setUploadsByThread\(previous=>\(\{\.\.\.previous,\[threadId\]:/);
  assert.match(sidebar,/pending>0\?'待確認':activity\.busy\?'處理中'/);
  assert.match(main,/api\/attachment\?id=\$\{a\.id\}&threadId=\$\{encodeURIComponent\(threadId\?\?'\'\)\}/);
  assert.match(main,/previewRequest\.current===requestId&&stateRef\.current\.threadId===threadId/);
  assert.match(main,/api\/artifact\?path=\$\{encodeURIComponent\(name\)\}&threadId=\$\{encodeURIComponent\(state\.threadId\?\?'\'\)\}&download=1/);
});

test('native review and branch operations retain the source thread id',()=>{
  assert.match(main,/<NativeReview state=\{state\} request=\{\(route,data=\{\}\)=>api\(route,\{\.\.\.data,threadId:state\.threadId\}\)\}/);
  assert.match(main,/function ProgressPanel\(\{state,action,request\}\)/);
  assert.match(main,/request\('goal',\{objective\}\)/);
  assert.match(main,/request\('compact',\{\}\)/);
  assert.match(main,/setModal\(\{type:'branch',threadId:state\.threadId/);
});

test('new conversation never defaults to an archived or missing workspace',()=>{
 const source=main;
 assert.match(source,/visible=projects\.filter\(p=>!p\.archived\)/);
 assert.match(source,/請先按「新增工作區」選擇工作資料夾/);
});
