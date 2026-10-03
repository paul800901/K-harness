// Built-UI regression for Codex Flash worker defaults; all catalogs and APIs are fake.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';

const server=await createServer({configFile:'vite.config.mjs',appType:'custom',server:{host:'127.0.0.1',port:5191,strictPort:true}});
server.middlewares.use('/probe',(_request,response)=>{response.setHeader('content-type','text/html');response.end('<!doctype html><html><body></body></html>');});
let browser;
try{
 await server.listen();
 browser=await chromium.launch({headless:true,...(process.env.K_UI_CHROMIUM?{executablePath:process.env.K_UI_CHROMIUM}:{channel:'msedge'})});
 const page=await browser.newPage();
 await page.route('**/api/**',route=>route.fulfill({json:{available:false,accounts:[],models:[],warnings:[]}}));
 await page.goto('http://127.0.0.1:5191/probe');
 await page.evaluate(async()=>{
  const [ReactModule,ReactDOM,{ModelPicker}]=await Promise.all([import('/@id/react'),import('/@id/react-dom/client'),import('/model-picker.jsx')]);
  const React=ReactModule.default??ReactModule,createRoot=ReactDOM.createRoot??ReactDOM.default?.createRoot;
  const models=[['gpt-6-luna','GPT-6 Luna'],['gpt-6.1-sol','GPT-6.1 Sol']].map(([model,displayName])=>({model,displayName,provider:'codex',available:true,defaultReasoningEffort:'high',supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort}))}));
  models.push({model:'gemini-3.8-flash',displayName:'Gemini 3.8 Flash',provider:'gemini',available:true});
  models.push({model:'claude-opus-5-5',displayName:'Opus 5.5',provider:'claude',available:true});
  window.renderPicker=(geminiGateway,props={})=>{window.pickerResult=null;window.pickerRoot?.unmount();document.body.replaceChildren();window.pickerRoot=createRoot(document.body.appendChild(document.createElement('div')));window.pickerRoot.render(React.createElement(ModelPicker,{...props,loadModels:async()=>({models,geminiGateway}),onCatalog:()=>{},onClose:()=>{},onCreate:value=>{window.pickerResult=value;}}));};
  window.renderPicker(true);
 });
 const worker=page.locator('.worker-settings');
 await worker.waitFor();await worker.locator('summary').click();
 const workerModel=page.getByLabel('子代理模型',{exact:true});
 const order=['auto','gemini-3.8-flash','gpt-6.1-sol','gpt-6-luna'];
 assert.deepEqual(await workerModel.locator('option').evaluateAll(items=>items.map(item=>item.value)),order);
 assert.deepEqual(await workerModel.locator('option').allTextContents(),['AI 自動選擇','Gemini 3.8 Flash','GPT-6.1 Sol','GPT-6 Luna']);
 assert.equal(await workerModel.inputValue(),'auto');assert.equal(await worker.locator('.step-hint').count(),0);
 await workerModel.selectOption('gemini-3.8-flash');
 const effort=page.getByLabel('子代理推理程度',{exact:true});
 assert.deepEqual(await effort.locator('option').evaluateAll(items=>items.map(item=>item.value)),['low','medium','high']);
 await effort.selectOption('medium');
 assert.match(await worker.innerText(),/Gemini 3\.8 Flash/u);
 await page.getByRole('button',{name:'建立對話',exact:true}).click();
 await page.waitForFunction(()=>window.pickerResult!==null);
 const result=await page.evaluate(()=>window.pickerResult);
 assert.deepEqual(result.workerPolicy,{model:'gemini-3.8-flash',effort:'medium'});
 await page.evaluate(()=>window.renderPicker(false));
 await worker.waitFor();await worker.locator('summary').click();
 const falseOptions=await page.getByLabel('子代理模型',{exact:true}).locator('option').evaluateAll(items=>items.map(item=>item.value));
 assert.deepEqual(falseOptions,['auto','gpt-6.1-sol','gpt-6-luna']);
  assert.doesNotMatch(await worker.innerText(),/Gemini 3\.8 Flash/u);
 await page.evaluate(()=>window.renderPicker(true,{currentModel:'claude-opus-5-5',currentWorkerPolicy:{model:'gpt-6.1-sol',effort:'high'}}));
 await worker.waitFor();await worker.locator('summary').click();
 assert.deepEqual(await workerModel.locator('option').evaluateAll(items=>items.map(item=>item.value)),order);
 assert.equal(await workerModel.inputValue(),'gpt-6.1-sol');assert.equal(await effort.inputValue(),'high');
 assert.equal(await worker.locator('.step-hint').count(),0);
 await page.evaluate(()=>window.renderPicker(true,{currentModel:'gemini-3.8-flash'}));
 await page.waitForFunction(()=>document.querySelector('[aria-label="主代理模型"]')?.textContent.includes('Gemini'));
 assert.equal(await worker.count(),0);assert.equal(await page.getByText('Gemini 使用 Antigravity 原生核心；目前未接入 K 的跨供應商子代理。',{exact:true}).count(),0);
 console.log(JSON.stringify({passed:true,checks:['GPT and Claude show auto / Flash / GPT-6.1 Sol / GPT-6 Luna regardless of catalog order','no redundant worker guidance hints','low/medium/high effort choices','selected Flash policy returned without a GPT fallback','false catalog flag hides Flash even when catalog model row exists','saved Sol/high stays selected','Gemini has no reverse-delegation hint']}));
}finally{await browser?.close();await server.close();}
