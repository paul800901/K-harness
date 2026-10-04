// Built-UI check with fake native state only; never connects to formal K or a provider.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {preview} from 'vite';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'.runtime/engineering-notices-20261001/ui');
const server=await preview({preview:{host:'127.0.0.1',port:5188,strictPort:true}});
const native="You've hit your session limit · resets 5:30pm (Asia/Taipei)";
const state={threadId:'claude-fake-quota',title:'假資料：額度通知',workspace:root,provider:'claude',model:'claude-opus-5-5',status:'failed',error:native,busy:false,messages:[],tools:[],questions:[],notices:[],artifacts:[],accessMode:'claude-manual',capabilities:{},conversationActivity:[]};
const requests=[];
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.K_UI_CHROMIUM});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 await page.addInitScript(state=>{window.EventSource=class{constructor(){window.testState=next=>this.onmessage?.({data:JSON.stringify({type:'snapshot',state:next})});setTimeout(()=>window.testState(state),0);}close(){}};},state);
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  requests.push({path:url.pathname,method:request.method()});
  const body=url.pathname==='/api/state'?state:
   url.pathname==='/api/projects'?{projects:[{path:root,name:'假工作區'}]}:
   url.pathname==='/api/sessions'?{sessions:[]}:
   url.pathname==='/api/models'?{models:[]}:
   url.pathname.endsWith('/auth')?{available:false}:{};
  await route.fulfill({json:body});
 });
 await page.goto('http://127.0.0.1:5188');
 const alert=page.locator('main > .alert');
 await alert.getByText('本時段額度已用完；17:30（臺灣時間）恢復。',{exact:true}).waitFor();
 assert.equal(await page.locator('main [role="alert"]').count(),1);
 assert.equal(await page.locator('.native-notices').isVisible(),false);
 assert.equal(await page.getByRole('button',{name:'知道了',exact:true}).count(),0);
 const bounds=await alert.boundingBox();assert.ok(bounds.height<=64,JSON.stringify(bounds));
 await mkdir(output,{recursive:true});
 await page.screenshot({path:path.join(output,'claude-quota.png'),fullPage:true});

 const codexMessage='Native quota limit reached';
 await page.evaluate(s=>window.testState(s),{...state,threadId:'codex-fake-quota',provider:'codex',error:codexMessage,notices:[{id:'same-error',kind:'nativeError',level:'error',message:codexMessage}]});
 await alert.getByText(codexMessage,{exact:true}).waitFor();
 assert.equal(await page.locator('main [role="alert"]').count(),1);
 assert.equal(await page.locator('.native-notices').isVisible(),false);
 await page.screenshot({path:path.join(output,'codex-single-error.png'),fullPage:true});

 const engineeringKinds=['status','deprecationNotice','configWarning','windowsWorldWritableWarning','windowsSandboxReadiness','windowsSandboxSetupCompleted'];
 const engineeringNotices=engineeringKinds.map((kind,index)=>({id:`engineering-${index}`,kind,level:'warning',message:`工程通知 ${kind}`}));
 await page.evaluate(s=>window.testState(s),{...state,threadId:'engineering-notices',provider:'codex',error:null,notices:engineeringNotices});
 await page.locator('main > .alert').waitFor({state:'hidden'});
 assert.equal(await page.locator('.native-notices > *').count(),0,'engineering notices must not render');
 assert.equal(await page.locator('.native-notices').boundingBox(),null,'hidden notices must not leave a blank region');
 assert.equal(await page.getByRole('button',{name:'關閉此通知'}).count(),0,'hidden notices must not leave dismiss buttons');
 for(const notice of engineeringNotices)assert.equal(await page.getByText(notice.message,{exact:true}).count(),0,notice.kind);
 await page.screenshot({path:path.join(output,'engineering-notices-hidden.png'),fullPage:true});

 const handoffs=[1,2].map(id=>({id:`handoff-${id}`,kind:'worker-completion',level:'info',message:'Flash 子代理結果已交給 Codex 主代理驗收。'}));
 await page.evaluate(s=>window.testState(s),{...state,threadId:'worker-handoffs',provider:'codex',error:null,notices:handoffs});
 assert.equal(await page.locator('.native-notices > *').count(),0);
 assert.equal(await page.locator('.native-notices').boundingBox(),null);
 assert.equal(await page.getByRole('button',{name:'關閉此通知'}).count(),0);
 assert.equal(await page.getByText(handoffs[0].message,{exact:true}).count(),0);
 await page.screenshot({path:path.join(output,'worker-handoffs-hidden.png'),fullPage:true});

 const retainedNotices=[
  {id:'unknown-warning',kind:'warning',level:'warning',message:'Important native warning'},
  {id:'guardian-warning',kind:'guardianWarning',level:'warning',message:'Guardian policy warning'},
  {id:'rerouted',kind:'modelRerouted',level:'warning',message:'Model rerouted for this turn'},
  {id:'native-error',kind:'nativeError',level:'error',message:'Native operation failed'},
  {id:'worker-error',kind:'worker-completion',level:'error',message:'Worker handoff failed'},
 ];
 await page.evaluate(s=>window.testState(s),{...state,threadId:'retained-notices',provider:'codex',error:null,notices:retainedNotices});
 for(const notice of retainedNotices)await page.getByText(notice.message,{exact:true}).waitFor();
 assert.equal(await page.locator('.native-notices > *').count(),retainedNotices.length);
 assert.equal(await page.getByRole('button',{name:'關閉此通知'}).count(),retainedNotices.length);
 await page.screenshot({path:path.join(output,'actionable-notices-retained.png'),fullPage:true});

 await page.evaluate(s=>window.testState(s),{...state,error:'Unknown native failure: request abc123'});
 await alert.getByText('Unknown native failure: request abc123',{exact:true}).waitFor();
 assert.equal(requests.some(r=>r.method==='POST'),false,'viewing notifications must not send or retry work');
 const result={passed:true,claudeAlertHeight:bounds.height,checks:['one localized Claude alert','native reset time retained','no duplicate notice or acknowledgment','one unchanged Codex error','six engineering notice kinds hidden','hidden notices leave no blank region or dismiss buttons','unknown warning, guardian warning, model reroute, and native error retained','unknown native details preserved','no POST or model work']};
 await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
