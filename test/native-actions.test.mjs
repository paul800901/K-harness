import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNativeActionAvailable,normalizeFileSearchQuery,normalizeNativeFileSearchResults,validateNativeReviewRequest} from '../src/native-actions.mjs';

test('review requires explicit confirmation and only selects inline uncommitted changes',()=>{
 assert.throws(()=>validateNativeReviewRequest(),/明確確認/);
 assert.throws(()=>validateNativeReviewRequest({confirmed:false}),/明確確認/);
 assert.deepEqual(validateNativeReviewRequest({confirmed:true}),{target:{type:'uncommittedChanges'},delivery:'inline'});
});

test('native action guard refuses provider mismatch and in-progress state',()=>{
 const base={provider:'codex',changing:false,sending:false,busy:false,questions:[],workspace:'C:\\repo'};
 assert.throws(()=>assertNativeActionAvailable({...base,provider:'claude'}),/不支援 Claude/);
 assert.throws(()=>assertNativeActionAvailable({...base,busy:true}),/尚未結束/);
 assert.throws(()=>assertNativeActionAvailable({...base,queued:1}),/待送訊息/);
 assert.throws(()=>assertNativeActionAvailable({...base,questions:[{}]}),/尚未結束/);
});

test('fuzzy search query is bounded and candidates remain scoped to the selected workspace',()=>{
 assert.equal(normalizeFileSearchQuery({query:'  foo  '}),'foo');
 assert.throws(()=>normalizeFileSearchQuery({query:'  '}),/不可為空/);
 assert.throws(()=>normalizeFileSearchQuery({query:'x'.repeat(257)}),/超過 256/);
 const workspace=process.cwd();
 const files=normalizeNativeFileSearchResults({files:[
  {root:workspace,path:'src/index.mjs',file_name:'index.mjs',match_type:'file',score:4,indices:[0]},
  {root:workspace,path:'../outside.txt',file_name:'outside.txt',match_type:'file',score:3},
  {root:workspace,path:'src/secret.txt',file_name:'secret.txt',match_type:'file',score:2},
  {root:'D:\\other',path:'D:\\other\\outside.txt',file_name:'outside.txt',match_type:'file',score:1},
  {root:workspace,path:'src/index.mjs',file_name:'duplicate',match_type:'directory',score:0},
 ]},workspace);
 assert.deepEqual(files,[{path:'src/index.mjs',fileName:'index.mjs',matchType:'file',score:4,indices:[0]},{path:'src/secret.txt',fileName:'secret.txt',matchType:'file',score:2}]);
 assert.equal(JSON.stringify(files).includes('secret.txt'),true); // names only; no file contents are read.
});
