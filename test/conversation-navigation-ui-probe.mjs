import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))); 
const port=5187,origin=`http://127.0.0.1:${port}`;
const built=process.env.K_NAVIGATION_UI_OUT_DIR?['preview','--outDir',resolve(root,process.env.K_NAVIGATION_UI_OUT_DIR)]:[];
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js',...built,'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore',windowsHide:true});
let browser;
const activity=[{threadId:'fake-A',workspace:'C:\\fake\\A',busy:true,status:'working',pendingQuestions:1},{threadId:'fake-B',workspace:'C:\\fake\\B',busy:false,status:'ready',pendingQuestions:0}];
const A={threadId:'fake-A',workspace:'C:\\fake\\A',title:'對話 A',model:'gpt-6-sol',provider:'codex',status:'working',busy:true,messages:[],tools:[],questions:[{id:'fake-question-A',kind:'approval',title:'需要操作核准',text:'隔離假資料',canAccept:true}],artifacts:[],accessMode:'workspace-write',capabilities:{},conversationActivity:activity};
const B={threadId:'fake-B',workspace:'C:\\fake\\B',title:'對話 B',model:'gpt-6-sol',provider:'codex',status:'ready',busy:false,messages:[],tools:[],questions:[],artifacts:[],accessMode:'workspace-write',capabilities:{},conversationActivity:activity};
const sessions=[{threadId:A.threadId,workspace:A.workspace,title:A.title,model:A.model,busy:true,pendingQuestions:1},{threadId:B.threadId,workspace:B.workspace,title:B.title,model:B.model,busy:false,pendingQuestions:0}];
const requests=[];
let active=A;
let openAState=A;
let holdASend=false,releaseASend;
try{
  process.env.PLAYWRIGHT_BROWSERS_PATH=resolve(root,'.runtime/playwright-browsers');
  const until=Date.now()+15000;
  while(Date.now()<until){try{const response=await fetch(origin);if(response.ok)break;}catch{}await delay(100);}
  browser=await chromium.launch({headless:true,executablePath:resolve(root,'.runtime/playwright-browsers/chromium-1246/chrome-win64/chrome.exe')});
  const page=await browser.newPage();
  const selectRoom=async title=>{
    await page.locator('.session-open').filter({hasText:title}).click();
    await page.waitForFunction(title=>document.querySelector('main header h1')?.textContent===title&&!document.querySelector('.session-open[aria-current="page"]')?.disabled,title);
  };
  await page.addInitScript(state=>{
    window.__fakeState=state;window.__fakeEs=null;
    window.__emitState=state=>{window.__fakeState=state;window.__fakeEs?.onmessage?.({data:JSON.stringify(state)});};
    window.EventSource=class{constructor(){window.__fakeEs=this;setTimeout(()=>{if(window.__fakeState)this.onmessage?.({data:JSON.stringify(window.__fakeState)});},0);}close(){}};
  },A);
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
    if(path==='/api/events'){await route.fulfill({status:200,contentType:'text/event-stream',body:''});return;}
    if(path==='/api/sessions'){await route.fulfill({json:{sessions}});return;}
    if(path==='/api/projects'){await route.fulfill({json:{projects:[{path:A.workspace,name:'工作區 A'},{path:B.workspace,name:'工作區 B'}]}});return;}
    if(method==='POST'){
      const data=route.request().postDataJSON();requests.push({path,data});
      if(path==='/api/open'){
        active=data.threadId===A.threadId?openAState:B;
        await page.evaluate(state=>window.__emitState(state),active);
        await route.fulfill({json:{opened:true}});return;
      }
      if(path==='/api/upload'){await route.fulfill({json:{id:'fake-attachment-A',name:data.name,size:3,kind:'text'}});return;}
      if(path==='/api/send'){
        if(data.threadId===A.threadId&&holdASend){await new Promise(resolve=>{releaseASend=(success=true)=>{route.fulfill(success?{json:{sent:true}}:{status:400,json:{error:'隔離測試：未送出'}}).then(resolve);};});return;}
        await route.fulfill({json:{sent:true}});return;
      }
      if(path==='/api/stop'){
        if(data.threadId===B.threadId){B.busy=false;B.status='interrupted';active=B;await page.evaluate(state=>window.__emitState(state),B);}
        await route.fulfill({json:{stopped:true}});return;
      }
      if(path==='/api/models'){await route.fulfill({json:{models:[]}});return;}
      await route.fulfill({json:{ok:true}});return;
    }
    await route.fulfill({json:{ok:true}});
  });
  await page.goto(origin);
  await page.locator('.session-open').filter({hasText:'對話 A'}).waitFor();
  if((await page.locator('.session-activity').filter({hasText:'需要確認'}).count())!==1)throw Error('A pending confirmation is not visible in the sidebar');
  const evidenceDir=resolve(root,process.env.K_NAVIGATION_UI_EVIDENCE??'.runtime/conversation-navigation-ui-20260925/evidence');await mkdir(evidenceDir,{recursive:true});
  const composer=page.locator('textarea[aria-label="工作訊息"]');
  await composer.fill('A 草稿保留');
  await page.locator('input[type="file"]').setInputFiles({name:'假附件.txt',mimeType:'text/plain',buffer:Buffer.from('abc')});
  await page.locator('.file-chip').filter({hasText:'假附件.txt'}).waitFor();
  await selectRoom('對話 B');
  await page.locator('textarea[aria-label="工作訊息"]').waitFor();
  await page.screenshot({path:resolve(evidenceDir,'A-pending-while-B-selected.png'),fullPage:true});
  if(await page.locator('[aria-label="需要你的確認"]').count())throw Error('A confirmation leaked into B');
  if((await page.locator('.session-activity').filter({hasText:'需要確認'}).count())!==1)throw Error('A sidebar confirmation disappeared while B is selected');
  await page.locator('textarea[aria-label="工作訊息"]').fill('B 訊息');
  await page.getByRole('button',{name:'送出訊息'}).click();
  await page.waitForFunction(()=>true);
  const send=requests.find(request=>request.path==='/api/send');
  if(send?.data.threadId!==B.threadId)throw Error(`B send used wrong thread: ${JSON.stringify(send?.data)}`);
  B.busy=true;B.status='working';active=B;await page.evaluate(state=>window.__emitState(state),B);
  await page.getByRole('button',{name:'停止工作'}).click();
  const stop=requests.find(request=>request.path==='/api/stop');
  if(stop?.data.threadId!==B.threadId)throw Error(`B stop used wrong thread: ${JSON.stringify(stop?.data)}`);
  await selectRoom('對話 A');
  const restored=page.locator('textarea[aria-label="工作訊息"]');
  await restored.waitFor();
  if(await restored.inputValue()!=='A 草稿保留')throw Error(`A draft was not restored: ${await restored.inputValue()}`);
  await page.locator('.file-chip').filter({hasText:'假附件.txt'}).waitFor();
  if(await page.locator('[aria-label="需要你的確認"]').count()!==1)throw Error('A confirmation was not restored with A');
  await page.locator('.file-chip').filter({hasText:'假附件.txt'}).getByRole('button',{name:/移除附件/}).click();
  const Aready={...A,busy:false,status:'ready',questions:[]};openAState=Aready;active=Aready;await page.evaluate(state=>window.__emitState(state),Aready);
  await page.locator('textarea[aria-label="工作訊息"]').fill('A 傳送中測試');holdASend=true;
  await page.getByRole('button',{name:'送出訊息'}).click();
  for(let i=0;i<60&&(!releaseASend||!requests.some(request=>request.path==='/api/send'&&request.data.threadId===A.threadId));i++)await delay(50);
  if(!releaseASend)throw Error('A send request did not reach the isolated fake API');
  await selectRoom('對話 B');
  await page.locator('textarea[aria-label="工作訊息"]').waitFor();
  releaseASend();holdASend=false;await delay(100);
  await selectRoom('對話 A');
  const finalComposer=page.locator('textarea[aria-label="工作訊息"]');await finalComposer.waitFor();
  if(await finalComposer.inputValue()!=='')throw Error(`successful A send left a stale draft: ${await finalComposer.inputValue()}`);
  await finalComposer.fill('A 尚未送出的訊息');holdASend=true;releaseASend=null;
  await page.getByRole('button',{name:'送出訊息'}).click();
  for(let i=0;i<60&&!releaseASend;i++)await delay(50);
  if(!releaseASend)throw Error('failed A send did not reach the isolated fake API');
  await selectRoom('對話 B');
  releaseASend(false);holdASend=false;await delay(100);
  await selectRoom('對話 A');
  if(await page.locator('textarea[aria-label="工作訊息"]').inputValue()!=='A 尚未送出的訊息')throw Error('failed send after switching lost the original A draft');
  await page.locator('textarea[aria-label="工作訊息"]').fill('A 已送出的舊稿');holdASend=true;releaseASend=null;
  await page.getByRole('button',{name:'送出訊息'}).click();
  for(let i=0;i<60&&!releaseASend;i++)await delay(50);
  if(!releaseASend)throw Error('late-ack A send did not reach the isolated fake API');
  await selectRoom('對話 B');
  await selectRoom('對話 A');
  await page.locator('textarea[aria-label="工作訊息"]').fill('A 另外寫的新稿');
  releaseASend();holdASend=false;await delay(100);
  await selectRoom('對話 B');
  await selectRoom('對話 A');
  if(await page.locator('textarea[aria-label="工作訊息"]').inputValue()!=='A 另外寫的新稿')throw Error('late acknowledgement cleared a newer A draft');
  const result={ok:true,requests:requests.map(({path,data})=>({path,threadId:data.threadId??null})),assertions:['busy A remained navigable','B send used fake-B','B stop used fake-B','A draft restored','A attachment restored','A pending confirmation stayed in sidebar and never appeared in B','successful in-flight A send did not restore stale draft','failed in-flight A send restored original draft','late acknowledgement preserved newer A draft'],screenshot:resolve(evidenceDir,'A-pending-while-B-selected.png')};
  await writeFile(resolve(evidenceDir,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally {if(browser)await browser.close();server.kill();}
