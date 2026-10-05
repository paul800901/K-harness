// Built candidate UI + fake native history only; no formal K, accounts or model calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {preview} from 'vite';

const before=process.env.K_DIFFS_BEFORE==='1';
const output=path.resolve('.runtime/dsh-lessons-20261005',before?'ui-before':'ui-after');
await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:5207,strictPort:true}});
const workspace=process.cwd(),results=[],errors=[],requests=[];
// FileChangeThreadItem uses the installed Codex schema's required status and changes.
const change=(id,status)=>({id,name:'fileChange',status,patchChanges:[{path:`${id}.txt`,kind:{type:'update'},diff:`-old ${id}\n+new ${id}`}]});
const state={threadId:'fake-diff-history',workspace,title:'原生差異隔離測試',provider:'codex',model:'gpt-6-astra',status:'ready',busy:false,messages:[],tools:[change('completed','completed')],turnDiffs:[],questions:[],artifacts:[],accessMode:'workspace-write',capabilities:{review:true},conversationActivity:[]};
let browser,page;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_TEST_CHROME});
 for(const [width,height,scale,theme]of [[1920,1080,100,'warm'],[1100,760,125,'light'],[900,700,150,'dark']]){
  page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({state,scale,theme})=>{
   localStorage.setItem('k-appearance',JSON.stringify({interfaceScale:scale,dialogueFontSize:18}));localStorage.setItem('k-color-theme',theme);
   window.EventSource=class{constructor(){window.diffState=next=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:next})});setTimeout(()=>window.diffState(state),0);}close(){}};
  },{state,scale,theme});
  await page.route('**/api/**',async route=>{
   const request=route.request(),endpoint=new URL(request.url()).pathname;requests.push({method:request.method(),endpoint});
   const json=endpoint==='/api/state'?state:endpoint==='/api/projects'?{projects:[{path:workspace,name:'假工作區'}]}:endpoint==='/api/sessions'?{sessions:[]}:endpoint==='/api/models'?{models:[]}:endpoint.endsWith('/auth')?{available:false}:{};
   await route.fulfill({json});
  });
  await page.goto('http://127.0.0.1:5207');
  await page.getByRole('button',{name:'切換工具與成果面板',exact:true}).click();
  await page.getByText('檔案變更與檢視',{exact:true}).click();
  const diffs=page.locator('.native-diffs');
  await page.screenshot({path:path.join(output,`history-${width}.png`),fullPage:true});
  assert.equal(await diffs.count(),1,'restored patchChanges must be visible without a turn diff');
  const update=next=>page.evaluate(s=>window.diffState(s),{...state,...next});
  for(const review of [true,false]){
   await update({capabilities:{review},tools:[change('completed','completed'),change('active','inProgress'),change('streaming','running'),change('rejected','declined'),change('failed','failed'),change('unknown','futureStatus')]});
   const summaries=await diffs.locator('details > summary').allTextContents();
   assert.equal(summaries.length,6);for(const label of ['已完成','進行中','已拒絕','失敗','狀態未知'])assert.ok(summaries.some(text=>text.includes(label)),label);
   assert.equal(summaries.filter(text=>text.includes('已完成')).length,1);
   assert.equal(await diffs.getByText('尚未收到原生檔案差異；不代表檔案沒有改動。',{exact:true}).count(),0);
  }
  await diffs.locator('details > summary').first().click();await diffs.getByText('completed.txt',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,`states-${width}.png`),fullPage:true});
  await update({turnDiffs:[{turnId:'past-turn',diff:'-turn old\n+turn new'}],tools:[]});
  await diffs.getByText('回合 past-turn',{exact:true}).waitFor();
  await update({tools:[],turnDiffs:[],capabilities:{review:true}});
  assert.equal(await diffs.count(),0);assert.equal(await page.getByText('檔案變更與檢視',{exact:true}).count(),1,'native review stays available');
  for(const provider of ['claude','gemini']){
   await update({provider,tools:[],turnDiffs:[],capabilities:{turnDiffs:false,review:false}});
   assert.equal(await diffs.count(),0);assert.equal(await page.getByText('檔案變更與檢視',{exact:true}).count(),0,'do not invent another provider diff');
  }
  results.push({width,height,scale,theme,passed:true});await page.close();page=null;
 }
 assert.deepEqual(errors,[]);assert.equal(requests.some(request=>request.method!=='GET'),false,'viewing differences must never send, approve, retry or write');
 await writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,results,errors,onlyGetRequests:true},null,2));console.log(JSON.stringify({passed:true,results}));
}catch(error){
 await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true});
 await writeFile(path.join(output,'result.json'),JSON.stringify({passed:false,error:error.message,results,errors},null,2));throw error;
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
