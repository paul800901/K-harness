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
  const models=['gpt-6.1-sol','gpt-6-luna'].map(model=>({model,displayName:model,provider:'codex',available:true,defaultReasoningEffort:'high',supportedReasoningEfforts:['low','medium','high'].map(reasoningEffort=>({reasoningEffort}))}));
  models.push({model:'gemini-3.8-flash',displayName:'Gemini 3.8 Flash',provider:'gemini',available:true});
  window.renderPicker=geminiGateway=>{window.pickerResult=null;window.pickerRoot?.unmount();document.body.replaceChildren();window.pickerRoot=createRoot(document.body.appendChild(document.createElement('div')));window.pickerRoot.render(React.createElement(ModelPicker,{loadModels:async()=>({models,geminiGateway}),onCatalog:()=>{},onClose:()=>{},onCreate:value=>{window.pickerResult=value;}}));};
  window.renderPicker(true);
 });
 const worker=page.locator('.worker-settings');
 await worker.waitFor();await worker.locator('summary').click();assert.match(await worker.innerText(),/Gemini 3\.8 Flash，以及推理程度/u);await page.getByLabel('子代理模型',{exact:true}).selectOption('gemini-3.8-flash');
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
 assert.ok(!falseOptions.includes('gemini-3.8-flash'));
 assert.doesNotMatch(await worker.innerText(),/Gemini 3\.8 Flash/u);
 console.log(JSON.stringify({passed:true,checks:['catalog gateway flag enables catalog-listed Flash','low/medium/high effort choices','selected Flash policy returned without a GPT fallback','false catalog flag hides Flash even when catalog model row exists']}));
}finally{await browser?.close();await server.close();}
