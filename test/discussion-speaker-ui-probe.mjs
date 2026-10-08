// Built UI and HTTP/SSE; model answers are synthetic, not subscription turns.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {startDesktop} from '../src/desktop-server.mjs';
import {createConversationController} from '../src/conversation-controller.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';
const out=path.resolve('.runtime/quota-speaker-evidence');await mkdir(out,{recursive:true});const root=await mkdtemp(path.join(out,'ui-'));
const models=[['gpt-6.1-sol','GPT-6.1 Sol','codex'],['claude-opus-5-5','Claude Opus 5.5','claude'],['gemini-3.8-flash','Gemini 3.8 Flash','gemini'],['gpt-6-luna','GPT-6 Luna','codex']].map(([model,displayName,provider])=>({model,displayName,provider,available:true,inputModalities:['text'],defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}));
let seq=0,long=false;const calls=[];
const nativeFactory=({onChange})=>{
 const state={status:'idle',workspace:root,model:'gpt-6.1-sol',provider:'codex',modelDisplayName:'GPT-6.1 Sol',effort:'high',efforts:['high'],inputModalities:['text'],accessMode:'workspace-write',messages:[],questions:[],workers:[],tools:[],artifacts:[],busy:false,queuedMessages:[],progress:{},usage:{},capabilities:{goal:false,fileSearch:false},browserAccess:{enabled:false}};
 return {state,models:async()=>({models}),usage:async()=>({}),async workers(){return [];},async selectWorkspace({path}){state.workspace=path;},async open(data){state.threadId=data.threadId??`speaker-room-${++seq}`;state.model=data.model;state.status='ready';await saveMainSession(root,state);onChange();return {threadId:state.threadId};},async send(data){calls.push({op:'native-send',...data});state.messages.push({id:`native-${calls.length}`,role:'user',text:data.text,createdAt:new Date().toISOString()});onChange();return {sent:true};},async stop(){return {stopped:true};},async close(){},async metadata(data){await saveMainSession(root,{...state,...data});return data;}};
};
const discussionFactory=async({selection})=>({async ask(prompt){calls.push({op:'discussion',model:selection.model});if(selection.id==='host')return prompt.startsWith('你是多模型討論背景整理者')?'{"background":"這是帶日期的背景摘要，不是系統通知。"}':'## 共識\n保留正文可讀性。\n## 分歧\n不同意見仍保留。\n## 未知\n待查證。';
 const name=selection.displayName??selection.model;return `這是 ${name} 的意見。\n\n${long?Array.from({length:40},(_,i)=>`第 ${i+1} 段：這是長文測試，內容與樣式不冒充真實模型結論。正文保持原有深色字，發言者由全名與細線識別。`).join('\n\n'):'保留自己的理由與不同意見，不硬湊共識。'}`;},async close(){}});
const login=()=>({status:async()=>({available:true,auth:{loggedIn:true,authMethod:'chatgpt',planType:'Plus'},login:{status:'idle'}}),state:{status:'idle'},close:async()=>{}});
const luminance=rgb=>{const v=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
let browser,app;
try{
 app=await startDesktop({root,port:0,controllerFactory:opts=>createConversationController({...opts,sessionFactory:nativeFactory,discussionSessionFactory:discussionFactory}),claudeLoginFactory:login,codexLoginFactory:login,geminiLoginFactory:login,localDictationFactory:()=>({state:{available:false},close:async()=>{}})});
 await app.controller.open({model:'gpt-6.1-sol'});
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:980}}),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.createLaunchUrl());
 const mode=page.getByLabel('對話模式',{exact:true});await mode.waitFor();await mode.selectOption('parallel');await page.getByLabel('參與模型 2',{exact:true}).selectOption('claude-opus-5-5');
 await page.getByRole('button',{name:'加入參與者',exact:true}).click();await page.getByLabel('參與模型 3',{exact:true}).selectOption('gemini-3.8-flash');
 await page.getByRole('button',{name:'加入參與者',exact:true}).click();await page.getByLabel('參與模型 4',{exact:true}).selectOption('gpt-6-luna');
 await page.getByLabel('工作訊息',{exact:true}).fill('比較各模型的意見');await page.getByRole('button',{name:'送出訊息',exact:true}).click();await page.getByRole('heading',{name:'分歧',exact:true}).waitFor();
 await page.getByRole('button',{name:'參與者與背景',exact:true}).click();
 for(const [size,width,height] of [['desktop',1440,980],['mobile',390,844]]){
  await page.setViewportSize({width,height});if(size==='mobile')await page.getByRole('button',{name:'收合側欄',exact:true}).click();
  for(const theme of ['warm','light','dark']){
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
   const rows=await page.locator('.discussion-message').evaluateAll(nodes=>nodes.map(n=>{const body=n.querySelector('.assistant-body'),name=n.querySelector('.discussion-speaker strong'),footer=n.querySelector('.discussion-speaker-end');return {provider:n.dataset.discussionProvider,name:name.textContent,footer:footer?.textContent,color:getComputedStyle(name).color,fontSize:parseFloat(getComputedStyle(name).fontSize),border:getComputedStyle(body).borderLeftWidth,borderStyle:getComputedStyle(body).borderLeftStyle,textColor:getComputedStyle(n.querySelector('.assistant-response-content')).color,position:getComputedStyle(n.querySelector('.discussion-speaker')).position};}));
   assert.equal(rows.length,6);for(const m of models){const r=rows.find(r=>r.name===m.displayName);assert(r);assert.equal(r.footer,m.displayName);assert.equal(r.border,'3px');assert(r.fontSize>=14);assert.equal(r.position,'static');}
   const colors=['codex','claude','gemini'].map(provider=>rows.find(r=>r.provider===provider).color);assert.equal(new Set(colors).size,3);assert.equal(rows.find(r=>r.name==='GPT-6.1 Sol').color,rows.find(r=>r.name==='GPT-6 Luna').color);
   const summary=rows.find(r=>r.name==='討論整理（AI 產生）');assert.equal(summary.provider,'neutral');assert.equal(summary.borderStyle,'dashed');
   assert.equal(new Set(rows.map(r=>r.textColor)).size,1,'long text color must not change with speaker');
   const background=await page.evaluate(()=>{const el=document.createElement('span');el.style.color='var(--k-sheet)';document.body.append(el);const color=getComputedStyle(el).color;el.remove();return color;});
   const contrasts=colors.map(color=>{const a=luminance(color),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});assert(contrasts.every(c=>c>=4.5),`speaker text contrast failed ${theme}: ${contrasts}`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.locator('.discussion-message[data-discussion-provider="codex"]').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`${size}-${theme}.png`)});checks.push({size,theme,rows,contrasts});
  }
 }
 long=true;await page.getByLabel('工作訊息',{exact:true}).fill('請提供長文以驗證持續辨識');await page.getByRole('button',{name:'送出訊息',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.discussion-message').length===12&&document.querySelectorAll('.discussion-speaker-end').length>=10);
 const latest=page.locator('.discussion-message').filter({has:page.getByText('這是 Claude Opus 5.5 的意見。',{exact:true})}).last();await latest.scrollIntoViewIfNeeded();
 assert(await latest.locator('.assistant-body').evaluate(n=>n.clientHeight>1000));assert.equal(await latest.locator('.discussion-speaker-end').textContent(),'Claude Opus 5.5');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'mobile-long-text.png')});
 await mode.selectOption('normal');await page.getByLabel('工作訊息',{exact:true}).fill('回到一般對話');await page.getByRole('button',{name:'送出訊息',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.user-bubble')].some(n=>n.textContent.includes('回到一般對話')));assert.equal((await app.controller.sessions()).sessions.length,1);assert(calls.some(c=>c.op==='native-send'));
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'ui-result.json'),JSON.stringify({status:'passed',syntheticModelAnswers:true,checks,longText:true,sameProviderNames:true,ordinaryConversation:true,errors},null,2));console.log('Speaker desktop/mobile three-theme built UI passed');
}finally{await browser?.close();await app?.close();}
