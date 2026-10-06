// Headless fake-state probe for the capacity-fallback presentation; never contacts the live K backend.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';

const root=process.cwd(),out=path.resolve('.runtime/capacity-fallback-ui-probe');
await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5198,strictPort:true}}),errors=[],results=[];
let browser;
const catalog=[
 {model:'gpt-6-luna',provider:'codex',displayName:'GPT-6 Luna'},
 {model:'gpt-6.1-sol',provider:'codex',displayName:'GPT-6.1 Sol'},
];
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const [width,height,scale,theme] of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark']]){
  const page=await browser.newPage({viewport:{width,height}}),requests=[];
  page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(`${width}: ${error.message}`));
  const fallbackTurn='capacity-turn';
  const luna={threadId:'capacity-room',workspace:root,title:'假資料：容量交接',provider:'codex',model:'gpt-6-luna',modelDisplayName:'GPT-6 Luna',effort:'low',efforts:['low','medium','high','xhigh'],status:'ready',busy:false,capabilities:{},tools:[],artifacts:[],questions:[],notices:[],workers:[],conversationActivity:[],workerActivity:{running:0,uncertain:false,unconfirmed:0},messages:[
   {id:'original-user',role:'user',text:'原始假工作訊息，應保留顯示。',createdAt:new Date().toISOString(),turnId:'original-turn'},
   {id:'manual-change-user',role:'user',text:'一般手動模型變更內容。',createdAt:new Date().toISOString(),turnId:'manual-turn'},
  ],modelChanges:[{turnId:'manual-turn',fromModel:'gpt-6-luna',toModel:'gpt-6.1-sol',at:new Date().toISOString(),reason:'manual'}]};
  const sol={...luna,model:'gpt-6.1-sol',modelDisplayName:'GPT-6.1 Sol',effort:'medium',busy:true,status:'working',messages:[...luna.messages,
   {id:'capacity-continuation-1',role:'user',text:'SYSTEM_CONTINUATION_SECRET_one',createdAt:new Date().toISOString(),turnId:fallbackTurn},
   {id:'capacity-steer-user',role:'user',text:'請先回答我的問題',createdAt:new Date().toISOString(),turnId:fallbackTurn},
  ],modelChanges:[...luna.modelChanges,{turnId:fallbackTurn,fromModel:'gpt-6-luna',toModel:'gpt-6.1-sol',at:new Date().toISOString(),reason:'capacity',fromEffort:'high',toEffort:'medium'}]};
  await page.addInitScript(({initial,scale,theme})=>{
   if(!sessionStorage.getItem('capacity-fallback-state'))sessionStorage.setItem('capacity-fallback-state',JSON.stringify(initial));
   localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));
   localStorage.setItem('k-color-theme',theme);
   const emit=state=>window.__capacityFallbackSource?.onmessage?.({data:JSON.stringify({type:'snapshot',state})});
   window.testState=state=>{sessionStorage.setItem('capacity-fallback-state',JSON.stringify(state));emit(state);};
   window.EventSource=class{constructor(){window.__capacityFallbackSource=this;setTimeout(()=>{const state=JSON.parse(sessionStorage.getItem('capacity-fallback-state'));this.onopen?.();this.onmessage?.({data:JSON.stringify({type:'snapshot',state})});},0);}close(){}};
  },{initial:luna,scale,theme});
  await page.route('**/api/**',route=>{
   requests.push(route.request().method());const pathname=new URL(route.request().url()).pathname;
   const result=pathname==='/api/state'?luna:pathname==='/api/projects'?{projects:[{path:root,name:'假工作區'}]}:pathname==='/api/sessions'?{sessions:[]}:pathname==='/api/models'?{models:catalog}:pathname.endsWith('/auth')?{available:false}:{};
   return route.fulfill({json:result});
  });
  await page.goto('http://127.0.0.1:5198');
  const effort=page.getByRole('combobox',{name:'推理程度'}),model=page.getByRole('button',{name:'選擇主代理模型'});
  await effort.waitFor();assert.equal(await effort.inputValue(),'');
  await effort.selectOption('high');assert.equal(await effort.inputValue(),'high','Luna high remains a local draft before state changes');
  await page.evaluate(state=>window.testState(state),sol);
  const capacityNote=page.locator('.capacity-model-change-note');await capacityNote.waitFor();
  assert.equal((await capacityNote.textContent()).trim(),'服務容量不足，主代理已改由 GPT-6.1 Sol／中 接續（原 GPT-6 Luna）');
  assert.equal(await effort.inputValue(),'medium','fallback state, not the Luna high draft, is visible while busy');
  assert.equal(await effort.isDisabled(),true);
  assert.equal(await model.isDisabled(),true);
  assert.equal(await model.textContent(),'GPT-6.1 Sol','actual main model remains readable while disabled');
  assert.equal(await page.locator('.capacity-model-change-note').count(),1,'one capacity note for the turn');
  assert.equal(await page.locator('.user-bubble').filter({hasText:'SYSTEM_CONTINUATION_SECRET'}).count(),0,'system continuation is never shown as a user bubble');
  assert.equal(await page.locator('.user-bubble').filter({hasText:'請先回答我的問題'}).count(),1,'a real user steer in the same turn remains visible');
  assert.equal(await page.locator('.user-bubble').filter({hasText:'原始假工作訊息'}).count(),1,'the original user message remains visible');
  assert.equal((await page.locator('.model-change-note').textContent()).trim(),'主代理已切換：gpt-6-luna · Codex 訂閱 → GPT-6.1 Sol · Codex 訂閱','ordinary manual model-change text is unchanged');
  const disabledStyles=await page.evaluate(()=>{
   const sample=element=>{const style=getComputedStyle(element);return {display:style.display,opacity:style.opacity,color:style.color,background:style.backgroundColor,cursor:style.cursor};};
   return {model:sample(document.querySelector('.composer-model')),effort:sample(document.querySelector('.composer-effort select'))};
  });
  assert.equal(disabledStyles.model.opacity,'1','disabled model text is not dimmed');
  assert.equal(disabledStyles.effort.opacity,'1','disabled effort text remains fully opaque and readable');
  const controlBoxes=await page.evaluate(()=>{
   const selectors={model:'.composer-model',permission:'.permission-picker',effort:'.composer-effort'};
   const boxes=Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{const element=document.querySelector(selector);if(!element)return [name,{x:0,y:0,right:0,bottom:0,width:0,height:0,display:'missing'}];const r=element.getBoundingClientRect();return [name,{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,display:getComputedStyle(element).display}]}));
   const overlaps={};for(const [leftName,left] of Object.entries(boxes))for(const [rightName,right] of Object.entries(boxes)){if(leftName>=rightName)continue;overlaps[`${leftName}:${rightName}`]=left.width>0&&left.height>0&&right.width>0&&right.height>0&&left.x<right.right&&left.right>right.x&&left.y<right.bottom&&left.bottom>right.y;}
   return {boxes,overlaps};
  });
  for(const [pair,overlap] of Object.entries(controlBoxes.overlaps))assert.equal(overlap,false,`${pair} composer controls do not overlap at ${width}px / ${scale}%`);
  assert(controlBoxes.boxes.permission.width>0&&controlBoxes.boxes.effort.width>0,'permission and effort controls have visible bounding boxes');
  const widthOverflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth>innerWidth+1,composer:document.querySelector('.composer-controls').scrollWidth>document.querySelector('.composer-controls').clientWidth+1}));
  await page.screenshot({path:path.join(out,`${width}-${scale}-${theme}.png`),fullPage:true});
  await page.reload();
  await page.locator('.capacity-model-change-note').waitFor();
  assert.equal(await page.locator('.capacity-model-change-note').count(),1,'capacity note survives reload exactly once');
  assert.equal(await page.locator('.user-bubble').filter({hasText:'SYSTEM_CONTINUATION_SECRET'}).count(),0,'reload still hides system continuation text');
  assert.equal(await page.locator('.user-bubble').filter({hasText:'請先回答我的問題'}).count(),1,'reload keeps same-turn user steer visible');
  results.push({width,height,scale,theme,passed:true,disabledStyles,controlBoxes,widthOverflow,checks:['Luna high draft cleared by model/effort state update','busy selector shows actual Sol medium','model and effort controls disabled','disabled control readability styles','one capacity system note','initial system continuation hidden','same-turn user steer visible','original user message retained','manual note unchanged','capacity note and user steer persist after reload'],posts:requests.filter(method=>method==='POST').length});
  await page.close();
 }
 assert.deepEqual(errors,[]);
 assert(results.every(result=>result.posts===0),'probe must not send a work-changing backend request');
 await writeFile(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));
 console.log(JSON.stringify({results,errors},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
