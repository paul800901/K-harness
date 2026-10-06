// Built UI and synthetic long histories only. All API traffic is intercepted.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';

const root=process.cwd(),out=path.resolve('.runtime/process-details-20261006/ui');
await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5207,strictPort:true}}),results=[],errors=[];
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 for(const [width,height,scale,theme,provider] of [[1920,1080,100,'warm','codex'],[1100,760,125,'light','claude'],[900,700,150,'dark','gemini'],[390,844,100,'warm','codex']]){
  const page=await browser.newPage({viewport:{width,height}}),posts=[];
  page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
  const time=i=>new Date(1791250000000+i*1000).toISOString();
  const pair=(group,text)=>[{id:`${group}-u`,role:'user',groupId:group,turnId:group,text:'假資料：只驗證細節呈現。',createdAt:time(0)},{id:`${group}-a`,role:'assistant',groupId:group,turnId:group,text,createdAt:time(1),completedAt:time(60)}];
  let current={threadId:'fake-process-room',workspace:root,title:'長細節收合驗證（假資料）',provider,model:provider==='codex'?'gpt-6-luna':provider,accessMode:'read-only',status:'ready',busy:false,capabilities:{},artifacts:[],questions:[],notices:[],workers:[],conversationActivity:[],workerActivity:{running:0,uncertain:false,unconfirmed:0},messages:[...pair('old',Array(30).fill('先前回覆，不應跳回這裡。').join('\n\n')),...pair('target','本次目標回覆：收合後仍在這則訊息附近。'),...pair('later',Array(20).fill('後續回覆，用來驗證中段歷史的收合。').join('\n\n'))],reasoning:[{id:'reason',groupId:'target',text:Array(100).fill('原生摘要測試，內容保留。').join('\n')}],tools:Array.from({length:80},(_,i)=>({id:`tool-${i}`,groupId:'target',name:'commandExecution',createdAt:time(i+1),output:Array.from({length:60},(_,j)=>`工單 ${i} 行 ${j}：${'長工具輸出測試'.repeat(9)}`).join('\n')+'\n完整輸出尾端 '+i}))};
  await page.addInitScript(({initial,scale,theme})=>{
   localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);
   window.EventSource=class{constructor(){window.testState=s=>{this.onopen?.();this.onmessage?.({data:JSON.stringify({type:'snapshot',state:s})});};setTimeout(()=>window.testState(initial),0);}close(){}};
  },{initial:current,scale,theme});
  await page.route('**/api/**',route=>{
   const request=route.request(),p=new URL(request.url()).pathname;
   if(request.method()==='POST')posts.push(p);
   return route.fulfill({json:p==='/api/state'?current:p==='/api/projects'?{projects:[{path:root,name:'假工作區'}]}:p==='/api/sessions'?{sessions:[]}:p==='/api/models'?{models:[]}:p.endsWith('/auth')?{available:false}:{}});
  });
  await page.goto('http://127.0.0.1:5207');
  const message=page.locator('.assistant-message').filter({hasText:'本次目標回覆：'}),details=message.locator('.turn-process'),summary=details.locator('summary'),body=details.getByRole('region',{name:'處理細節'}),viewport=page.locator('.viewport');
  await summary.waitFor();assert.equal(await details.getAttribute('open'),null);
  // Keep the narrow-layout sidebar out of the way using its normal control.
  const sidebar=page.getByRole('button',{name:'收合側欄',exact:true});
  if(width<680&&await sidebar.count())await sidebar.click();
  await summary.click();await body.waitFor();
  assert.match(await summary.textContent(),/收合細節/);
  const dimensions=await body.evaluate(e=>({height:e.getBoundingClientRect().height,scroll:e.scrollHeight,client:e.clientHeight,preOverflow:[...e.querySelectorAll('pre')].map(p=>getComputedStyle(p).overflowY)}));
  assert(dimensions.height<=height*0.5+2,'the whole details body, not each output, has a viewport-aware cap');
  assert(dimensions.scroll>dimensions.client*20,'fixture is substantially longer than one screen');
  assert(dimensions.preOverflow.every(v=>v==='visible'),'one vertical scroller, not a nested scroller for every output');
  assert.match(await body.textContent(),/完整輸出尾端 79/,'display bounding never truncates retained output');
  const align=()=>details.evaluate(e=>{const v=e.closest('.viewport'),zoom=v.getBoundingClientRect().height/v.offsetHeight;v.scrollTop+=(e.getBoundingClientRect().top-v.getBoundingClientRect().top-10)/zoom;});
  await align();
  // Scroll the chat itself past the start of the open details. Its header pins.
  await viewport.evaluate(e=>{e.scrollTop+=60;});
  const checkHeader=async()=>{
   const metrics=await summary.evaluate(e=>{const r=e.getBoundingClientRect(),v=e.closest('.viewport').getBoundingClientRect(),hit=document.elementFromPoint(r.right-12,(r.top+r.bottom)/2);return {top:r.top,bottom:r.bottom,viewTop:v.top,viewBottom:v.bottom,hit:hit===e||e.contains(hit),background:getComputedStyle(e).backgroundColor};});
   assert(metrics.top>=metrics.viewTop-1&&metrics.bottom<=metrics.viewBottom+1,'collapse header remains visible');
   assert.equal(metrics.hit,true,'header remains clickable above content');if(await details.getAttribute('open')!==null)assert.notEqual(metrics.background,'rgba(0, 0, 0, 0)');
  };
  await checkHeader();
  await body.evaluate(e=>{e.scrollTop=e.scrollHeight;});
  const outerBefore=await viewport.evaluate(e=>e.scrollTop),box=await body.boundingBox();
  await page.mouse.move(box.x+box.width/2,Math.min(box.y+box.height-15,(await viewport.boundingBox()).y+(await viewport.boundingBox()).height-15));
  await page.mouse.wheel(0,800);await page.waitForTimeout(180);
  assert(Math.abs(await viewport.evaluate(e=>e.scrollTop)-outerBefore)<2,'wheel at the inner end does not fling the chat');
  await checkHeader();
  const innerBefore=await body.evaluate(e=>e.scrollTop);
  current={...current,tools:[...current.tools,{id:'stream-new',groupId:'target',name:'read_file',createdAt:time(100),output:'追加原生工具內容'}]};
  await page.evaluate(s=>window.testState(s),current);await body.getByText('追加原生工具內容',{exact:true}).waitFor({state:'attached'});
  assert(Math.abs(await body.evaluate(e=>e.scrollTop)-innerBefore)<2,'new output does not reset the reading position');
  await checkHeader();await page.screenshot({path:path.join(out,`${width}-${scale}-expanded.png`)});
  await summary.click();await body.waitFor({state:'detached'});await page.waitForTimeout(150);
  await checkHeader();
  assert.equal(await summary.evaluate(e=>document.activeElement===e),true);
  await page.screenshot({path:path.join(out,`${width}-${scale}-collapsed.png`)});
  // Native keyboard activation and a local Escape exit need no global shortcut.
  await summary.press('Enter');await body.waitFor();await body.focus();await page.keyboard.press('Escape');await body.waitFor({state:'detached'});await checkHeader();
  await summary.press('Space');await body.waitFor();await summary.press('Space');await body.waitFor({state:'detached'});
  // Short histories use their natural height; another turn's open state is independent.
  const old=page.locator('.turn-process').first();await old.locator('summary').click();assert.equal(await details.getAttribute('open'),null);
  const shortBody=old.locator('.turn-process-content');assert((await shortBody.boundingBox()).height<100);
  await old.locator('summary').click();
  current={...current,busy:true,status:'working',messages:current.messages.filter(m=>m.groupId!=='later').map(m=>m.id==='target-a'?{...m,partial:true,completedAt:null}:m)};
  await page.evaluate(s=>window.testState(s),current);await summary.filter({hasText:'已耗時'}).waitFor();
  await summary.click();await body.waitFor();await align();await checkHeader();
  current={...current,reasoning:[...current.reasoning,{id:'live-reason',groupId:'target',text:'工作進行中的追加摘要'}]};
  await page.evaluate(s=>window.testState(s),current);await body.getByText('工作進行中的追加摘要',{exact:true}).waitFor({state:'attached'});
  await summary.click();await body.waitFor({state:'detached'});await checkHeader();
  assert.equal(posts.length,0,'viewing/collapsing does not send, stop, restart, or replay work');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no page width overflow');
  results.push({width,height,scale,theme,provider,passed:true,outputRows:80,linesPerRow:60});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({passed:true,results}));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
