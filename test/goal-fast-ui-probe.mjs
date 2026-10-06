// Browser-only fake state; every API request is intercepted, never the live K service.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';

const root=process.cwd(),out=path.resolve('.runtime/goal-fast-20261006/ui');
await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5199,strictPort:true}}),results=[],errors=[];
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const [width,height,scale,theme] of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark']]){
  const page=await browser.newPage({viewport:{width,height}}),posts=[];
  page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  let current={threadId:'fake-fast-room',workspace:root,title:'原生加速與受阻恢復（假資料）',provider:'codex',model:'gpt-6-luna',modelDisplayName:'GPT-6 Luna',effort:'low',efforts:['low','medium','high'],serviceTier:'default',fastTier:{id:'priority',name:'Fast',description:'Native catalog description'},accessMode:'read-only',status:'ready',busy:false,capabilities:{goal:true,goalEdit:true,goalContinuesWhileIdle:true},tools:[],artifacts:[],questions:[],notices:[],workers:[],conversationActivity:[],workerActivity:{running:0,uncertain:false,unconfirmed:0},messages:[],goal:{objective:'假目標：保留原有目標，不重送工作',status:'blocked',tokenBudget:9000,tokensUsed:100,createdAt:1}};
  await page.addInitScript(({initial,scale,theme})=>{
   if(!sessionStorage.getItem('goal-fast-state'))sessionStorage.setItem('goal-fast-state',JSON.stringify(initial));
   localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);
   window.testState=state=>{sessionStorage.setItem('goal-fast-state',JSON.stringify(state));window.__fastSource?.onmessage?.({data:JSON.stringify({type:'snapshot',state})});};
   window.EventSource=class{constructor(){window.__fastSource=this;setTimeout(()=>{this.onopen?.();window.testState(JSON.parse(sessionStorage.getItem('goal-fast-state')));},0);}close(){}};
  },{initial:current,scale,theme});
  await page.route('**/api/**',async route=>{
   const request=route.request(),pathname=new URL(request.url()).pathname;
   if(request.method()==='POST'){
    const data=request.postDataJSON();posts.push({pathname,data});
    if(pathname==='/api/model')current={...current,serviceTier:data.serviceTier};
    else if(pathname==='/api/goal')current={...current,goal:{...current.goal,status:'active'}};
    else throw Error(`Unexpected mutation ${pathname}`);
    await route.fulfill({json:{serviceTier:current.serviceTier,goal:current.goal}});await page.evaluate(s=>window.testState(s),current);return;
   }
   const result=pathname==='/api/state'?current:pathname==='/api/projects'?{projects:[{path:root,name:'假工作區'}]}:pathname==='/api/sessions'?{sessions:[]}:pathname==='/api/models'?{models:[{model:current.model,provider:current.provider,displayName:current.modelDisplayName}]}:pathname.endsWith('/auth')?{available:false}:{};
   await route.fulfill({json:result});
  });
  await page.goto('http://127.0.0.1:5199');
  const trigger=page.getByRole('button',{name:'推理程度與速度',exact:true}),speed=page.getByRole('switch',{name:'原生加速'});
  await trigger.waitFor();assert.equal(await speed.isVisible(),false,'speed is not exposed as an accidental one-click control');
  await trigger.click();assert.equal(await speed.isChecked(),false);assert.equal(posts.length,0,'opening the popup does not enable speed');
  await trigger.click();assert.equal(await speed.isVisible(),false,'clicking the trigger again closes the popup');await trigger.click();
  await page.getByRole('combobox',{name:'推理程度',exact:true}).selectOption('high');assert.equal(posts.length,0);
  await trigger.click();await speed.click();await page.waitForFunction(()=>document.querySelector('.reasoning-fast-label')?.textContent==='加速');
  assert.deepEqual(posts[0],{pathname:'/api/model',data:{model:'gpt-6-luna',serviceTier:'priority',threadId:'fake-fast-room'}});
  assert.match(await trigger.textContent(),/高.*加速/,'speed toggle preserves the independent effort draft');
  await trigger.click();await page.screenshot({path:path.join(out,`${width}-${scale}-fast.png`),fullPage:true});
  const bounds=await page.locator('.reasoning-popover').boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1);
  await page.keyboard.press('Escape');assert.equal(await speed.isVisible(),false);
  await trigger.click();await page.locator('main>header h1').click({position:{x:5,y:5}});assert.equal(await speed.isVisible(),false);
  await page.reload();await trigger.waitFor();assert.match(await trigger.textContent(),/加速/,'persisted state survives reload');
  current={...current,busy:true,status:'working',effectiveServiceTier:'default'};await page.evaluate(s=>window.testState(s),current);
  await page.waitForFunction(()=>!document.querySelector('.reasoning-fast-label'));
  assert.equal(await trigger.isDisabled(),true);assert.match(await trigger.textContent(),/下次送出套用/,'native goal continuation still uses actual standard until the next submitted turn');
  current={...current,effectiveServiceTier:null};await page.evaluate(s=>window.testState(s),current);
  await page.waitForFunction(()=>document.querySelector('.reasoning-trigger')?.textContent.includes('核心速度待確認'));
  assert.equal(await page.locator('.reasoning-fast-label').count(),0,'a lost acknowledgement does not assert acceleration');
  assert.doesNotMatch(await trigger.textContent(),/下次送出套用/,'unknown is not a confirmed difference');
  current={...current,effectiveServiceTier:'default'};
  current={...current,busy:false,status:'ready'};await page.evaluate(s=>window.testState(s),current);
  await trigger.click();await speed.click();await page.waitForFunction(()=>!document.querySelector('.reasoning-fast-label'));
  assert.equal(posts.at(-1).data.serviceTier,'default','standard is an explicit native tier');
  current={...current,busy:true,status:'working'};await page.evaluate(s=>window.testState(s),current);
  assert.equal(await trigger.isDisabled(),true);assert.match(await trigger.textContent(),/低/,'busy uses actual native effort');
  // A busy ordinary turn must not disable status-only restoration of this blocked goal.
  await page.getByRole('button',{name:/目標.*受阻/}).click();const resume=page.getByRole('button',{name:'繼續目標',exact:true});
  assert.equal(await resume.isEnabled(),true);await resume.click();await page.waitForFunction(()=>document.body.textContent.includes('進行中'));
  assert.deepEqual(posts.at(-1),{pathname:'/api/goal',data:{status:'active',resumeOnly:true,threadId:'fake-fast-room'}});
  await page.getByRole('button',{name:'關閉',exact:true}).click();
  current={...current,busy:false,status:'ready',fastTier:null};await page.evaluate(s=>window.testState(s),current);await trigger.click();assert.equal(await speed.count(),0,'no tier supplied by the native model catalog means no switch');await page.keyboard.press('Escape');
  for(const provider of ['gemini','claude']){current={...current,provider,model:provider==='gemini'?'gemini-flash':'claude-opus',modelDisplayName:provider};await page.evaluate(s=>window.testState(s),current);await trigger.waitFor({state:'hidden'});assert.equal(await trigger.count(),0);assert.equal(await speed.count(),0);}
  assert.equal(posts.length,3,'only explicit speed on/off and goal resume requests');
  results.push({width,height,scale,theme,passed:true,posts});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({passed:true,viewports:results.length}));
}finally{for(const context of browser?.contexts()??[])for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser?.close();await new Promise(r=>server.httpServer.close(r));}
