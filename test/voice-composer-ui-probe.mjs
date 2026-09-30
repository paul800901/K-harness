// Production renderer + preload + HTTP + local Whisper. No provider or real microphone.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'.runtime/voice-notices-20261001');
await mkdir(output,{recursive:true});
const run=await mkdtemp(path.join(output,'native-ui-'));
const env={...process.env,K_VOICE_TEST_ROOT:run,K_VOICE_TEST_WAV:'D:\\K-harness\\.runtime\\voice-repair-20260926\\synthetic-voice.wav'};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[path.join(root,'test/fixtures/voice-composer-app.cjs')],env,timeout:20000});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);
 await page.waitForURL('http://127.0.0.1:*/');
 const mic=page.getByRole('button',{name:'開始聽寫',exact:true});
 const draft=page.locator('textarea.composer-input');
 await draft.fill('原草稿保留');
 await mic.click();
 await page.getByRole('region',{name:'啟用本機聽寫'}).waitFor();
 assert.equal(await page.getByRole('region',{name:'啟用瀏覽器聽寫'}).count(),0);
 await page.getByRole('button',{name:'同意並開始聽寫',exact:true}).click();
 const stop=page.getByRole('button',{name:'停止聽寫',exact:true});
 await stop.waitFor();
 await page.waitForTimeout(8200); // Capture one complete synthetic sentence.
 await stop.click();
 await page.waitForFunction(()=>document.querySelector('textarea.composer-input')?.value.includes('語音'),null,{timeout:120000});
 const text=await draft.inputValue();assert.ok(text.startsWith('原草稿保留'));assert.ok(text.length>15);
 const first=await app.evaluate(()=>({calls:fixture.calls,sends:fixture.sends}));
 assert.equal(first.calls.length,1);assert.equal(first.sends.length,0);assert.ok(first.calls[0].bytes>16000);

 await mic.click();await stop.waitFor();
 await page.getByRole('button',{name:'取消聽寫',exact:true}).click();
 assert.equal(await draft.inputValue(),text);
 assert.equal(await app.evaluate(()=>fixture.calls.length),1);
 await app.evaluate(()=>{fixture.fail=true;});
 await mic.click();await stop.waitFor();await page.waitForTimeout(300);await stop.click();
 await page.getByText('轉錄要求無法處理。 未送出；原草稿保留。',{exact:true}).waitFor();
 assert.equal(await draft.inputValue(),text);
 assert.equal(await app.evaluate(()=>fixture.sends.length),0);
 const result={passed:true,text,checks:['actual native preload selects local consent','synthetic microphone to real local Whisper to retained draft','stop does not send','cancel keeps draft and makes no request','transcription error keeps draft without send'],realMicrophone:false,providerCalls:0};
 await writeFile(path.join(run,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({run,...result}));
}finally{if(app){await app.evaluate(async()=>{await global.fixture?.close?.();}).catch(()=>{});await app.close();}}
