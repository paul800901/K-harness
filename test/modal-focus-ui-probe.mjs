// Real built UI with fake API data only; never opens or changes a user's chat.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';
const baseline=process.env.K_EXPECT_CLIPPED==='1';
const output=path.resolve('.runtime/modal-focus-20261004',baseline?'before':'after');
await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5198,strictPort:true}});
const workspace=process.cwd(),results=[],gestures=[],errors=[];
const state={threadId:'fake-focus',workspace,status:'ready',busy:false,model:'gpt-6.1-sol',provider:'codex',messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',conversationActivity:[],capabilities:{}};
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [width,height,scale,theme]of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark']]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({state,scale,theme})=>{localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);window.EventSource=class{constructor(){setTimeout(()=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state})}),0);}close(){}};},{state,scale,theme});
  await page.route('**/api/**',async route=>{
   assert.equal(route.request().method(),'GET','No writes needed for this visual test');
   const endpoint=new URL(route.request().url()).pathname;
   const json=endpoint==='/api/state'?state: endpoint==='/api/projects'?{projects:[{path:workspace,name:'假工作區'},{path:workspace+'/second',name:'另一個假工作區'}]}:
    endpoint==='/api/sessions'?{sessions:[{threadId:'fake-focus',title:'焦點框測試',model:'gpt-6.1-sol',provider:'codex',workspace}]}:
    endpoint==='/api/models'?{models:[{model:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',provider:'codex',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]}]}:
    endpoint==='/api/gemini/accounts'?{enabled:true,accounts:[],loginPending:false}:
    endpoint.endsWith('/auth')?{available:true,auth:{loggedIn:true,authMethod:endpoint.includes('claude')?'claude.ai':'chatgpt',apiProvider:'firstParty',subscriptionType:'pro'},login:{status:'idle'}}:{};
   await route.fulfill({json});
  });
  async function checkRing(label,locator){
   await page.keyboard.press('Tab');
   await locator.focus();
   const geometry=await locator.evaluate(element=>{
    const style=getComputedStyle(element),body=element.closest('.modal-body'),r=element.getBoundingClientRect(),b=body.getBoundingClientRect();
    const zoom=Number(getComputedStyle(document.documentElement).getPropertyValue('--k-ui-scale'))||1;
    const extent=(parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset))*zoom;
    return {focusVisible:element.matches(':focus-visible'),outline:style.outlineStyle,extent,gaps:{left:r.left-b.left-extent,right:b.right-(body.offsetWidth-body.clientWidth)*zoom-r.right-extent,top:r.top-b.top-extent,bottom:b.bottom-(body.offsetHeight-body.clientHeight)*zoom-r.bottom-extent},horizontalOverflow:body.scrollWidth>body.clientWidth};
   });
   assert.equal(geometry.focusVisible,true);assert.equal(geometry.outline,'solid');assert(geometry.extent>0,'Keep the visible outer focus ring');
   results.push({label,width,height,scale,theme,...geometry,clipped:Object.values(geometry.gaps).some(gap=>gap<-.5)});
   await page.screenshot({path:path.join(output,`${scale}-${label}.png`)});
  }
  await page.goto('http://127.0.0.1:5198');
  await page.getByRole('button',{name:'新對話',exact:true}).click();
  const select=page.getByLabel('新對話工作區',{exact:true});await select.waitFor();
  await checkRing('workspace',select);
  await select.selectOption(workspace+'/second');assert.equal(await select.inputValue(),workspace+'/second');
  await page.getByRole('dialog').getByRole('button',{name:'關閉',exact:true}).click();
  await page.getByLabel('管理對話 焦點框測試',{exact:true}).click();
  await page.getByRole('button',{name:'重新命名',exact:true}).click();
  const rename=page.getByRole('dialog'),input=rename.locator('input');
  await checkRing('rename',input);
  await input.fill('這是拖曳選字測試，不可關閉');
  const field=await input.boundingBox(),modal=await rename.boundingBox();
  await page.mouse.move(field.x+field.width/2,field.y+field.height/2);await page.mouse.down();
  await page.mouse.move(modal.x-15,field.y+field.height/2,{steps:10});await page.mouse.up();
  const dismissed=await rename.count()===0;
  gestures.push({scale,insideToOutsideDismissed:dismissed});
  assert.equal(dismissed,baseline,'Selection drag outside must not dismiss the modal');
  if(!baseline){
   assert(await input.evaluate(e=>e.selectionEnd>e.selectionStart),'Text remains selected for copying');
   await page.mouse.move(modal.x-15,field.y+field.height/2);await page.mouse.down();
   await page.mouse.move(field.x+20,field.y+field.height/2);await page.mouse.up();
   assert.equal(await rename.isVisible(),true,'Drag from backdrop into modal must not dismiss');
   await page.mouse.click(modal.x-15,field.y+field.height/2);await rename.waitFor({state:'hidden'});
   await page.getByLabel('管理對話 焦點框測試',{exact:true}).click();
   await page.getByRole('button',{name:'重新命名',exact:true}).click();
   await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  }
  await page.getByRole('button',{name:'設定',exact:true}).click();
  const dialog=page.getByRole('dialog'),close=dialog.getByRole('button',{name:'關閉',exact:true});
  await dialog.getByText(/目前 Antigravity 登入已驗證/).waitFor();
  const headerBefore=await close.boundingBox();
  await dialog.locator('.modal-body').evaluate(body=>{body.scrollTop=body.scrollHeight;});
  await checkRing('settings-bottom',dialog.getByRole('button',{name:'完成',exact:true}));
  const headerAfter=await close.boundingBox();assert(Math.abs(headerAfter.y-headerBefore.y)<1,'Close button must stay fixed while body scrolls');
  await close.click();await dialog.waitFor({state:'hidden'});await page.close();
 }
 assert.deepEqual(errors,[]);
 const clipped=results.filter(r=>r.clipped);
 if(baseline)assert(clipped.some(r=>r.label==='workspace')&&clipped.some(r=>r.label==='rename'),'Reproduce both reported failures');
 else{assert.deepEqual(clipped,[],'All focus rings must fit the scroll area');assert(results.every(r=>!r.horizontalOverflow),'No new horizontal scrollbars');}
 console.log(JSON.stringify({baseline,cases:results.length,clipped:clipped.length,gestures,passed:true}));
}finally{await writeFile(path.join(output,'result.json'),JSON.stringify({baseline,results,gestures,errors},null,2));await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
