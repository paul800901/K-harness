import {fileURLToPath} from 'node:url';
import {openCodexHost} from '../src/codex-host.mjs';
const executable=process.argv[2];if(!executable)throw new Error('Supply installed Codex executable.');
const host=openCodexHost({executable,cwd:fileURLToPath(new URL('../',import.meta.url))});
try {
 await host.request('initialize',{clientInfo:{name:'k_harness',version:'0.1.0'}});
 host.notify({method:'initialized',params:{}});
 const auth=await host.request('account/read',{refreshToken:false});
 const models=await host.request('model/list',{limit:100,includeHidden:false});
 console.log(JSON.stringify({accountType:auth.account?.type??null,requiresOpenaiAuth:auth.requiresOpenaiAuth,models:models.data.filter(m=>['gpt-6-astra','gpt-5.6-sol'].includes(m.model)).map(m=>({model:m.model,effort:m.defaultReasoningEffort,supported:m.supportedReasoningEfforts}))},null,2));
}finally{await host.close();}
