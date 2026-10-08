// Built React + HTTP/SSE + actual discussion controller. Native model responses
// are synthetic here; subscription evidence is recorded separately.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {startDesktop} from '../src/desktop-server.mjs';
import {createConversationController} from '../src/conversation-controller.mjs';
import {saveMainSession} from '../src/main-sessions.mjs';

const out=path.resolve('.runtime/discussion-evidence');await mkdir(out,{recursive:true});const root=await mkdtemp(path.join(out,'ui-'));
const models=[['gpt-6.1-sol','GPT-6.1 Sol','codex'],['claude-opus-5-5','Claude Opus 5.5','claude'],['gemini-3.8-flash','Gemini 3.8 Flash','gemini']].map(([model,displayName,provider])=>({model,displayName,provider,available:true,inputModalities:['text'],defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]}));
let seq=0,slow=false;const calls=[],pending=new Set();
const nativeFactory=({onChange})=>{
 const state={status:'idle',workspace:root,model:'gpt-6.1-sol',provider:'codex',modelDisplayName:'GPT-6.1 Sol',effort:'medium',efforts:['medium','high'],inputModalities:['text'],accessMode:'workspace-write',messages:[],questions:[],workers:[],tools:[],artifacts:[],busy:false,queuedMessages:[],progress:{},usage:{},capabilities:{goal:false,fileSearch:false},browserAccess:{enabled:false}};
 return {state,models:async()=>({models}),usage:async()=>({}),async workers(){return [];},async selectWorkspace({path}){state.workspace=path;},async open(data){state.threadId=data.threadId??`ui-room-${++seq}`;state.model=data.model;state.status='ready';await saveMainSession(root,state);onChange();return {threadId:state.threadId};},async send(data){calls.push({op:'native-send',...data});state.messages.push({id:`native-${calls.length}`,role:'user',text:data.text,createdAt:new Date().toISOString()});onChange();return {sent:true};},async stop(){return {stopped:true};},async close(){},async metadata(data){await saveMainSession(root,{...state,...data});return data;}};
};
const discussionFactory=async({selection})=>({async ask(prompt){calls.push({op:'discussion',id:selection.id,prompt});if(selection.id==='host')return prompt.startsWith('你是多模型討論背景整理者')?'{"background":"原始需求與重要修正已帶入。"}':prompt.includes('平行比較直接整理')?'## 共識\n目標清楚。\n## 分歧\nSol 偏重速度，Opus 偏重資訊。\n## 未知\n仍需查證。':JSON.stringify({action:'finish',summary:'## 共識\n目標清楚。\n## 分歧\nSol 偏重速度，Opus 偏重資訊。\n## 未知\n仍需查證。'});if(slow)await new Promise((resolve,reject)=>pending.add(reject));return selection.id==='p1'?'Sol 的原始觀點：重視速度。':'Opus 的原始觀點：重視資訊。';},async close(){for(const reject of pending)reject(Error('fake native stopped'));pending.clear();}});
const login=()=>({status:async()=>({available:true,auth:{loggedIn:true,authMethod:'chatgpt',planType:'Plus'},login:{status:'idle'}}),state:{status:'idle'},close:async()=>{}});
let browser,app;
try{
 app=await startDesktop({root,port:0,controllerFactory:opts=>createConversationController({...opts,sessionFactory:nativeFactory,discussionSessionFactory:discussionFactory}),claudeLoginFactory:login,codexLoginFactory:login,geminiLoginFactory:login,localDictationFactory:()=>({state:{available:false},close:async()=>{}})});
 const a=await app.controller.open({model:'gpt-6.1-sol'});
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:980}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.createLaunchUrl());
 const mode=page.getByLabel('對話模式',{exact:true});await mode.waitFor();await mode.selectOption('parallel');await page.getByLabel('參與模型 2',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('[aria-label="參與模型 2"]').value==='claude-opus-5-5');
 await page.getByLabel('工作訊息',{exact:true}).fill('請比較速度與資訊的取捨');await page.getByRole('button',{name:'送出訊息',exact:true}).click();
 await page.getByText('Sol 的原始觀點：重視速度。',{exact:true}).waitFor();await page.getByText('Opus 的原始觀點：重視資訊。',{exact:true}).waitFor();await page.getByRole('heading',{name:'分歧',exact:true}).waitFor();
 assert.equal((await app.controller.sessions()).sessions.length,1);assert.equal(calls.some(c=>c.op==='native-send'),false);await page.screenshot({path:path.join(out,'discussion-desktop.png')});
 await mode.selectOption('review');await page.getByLabel('被審查內容',{exact:true}).fill('要審查的指定方案');await page.getByLabel('工作訊息',{exact:true}).fill('請審查指定方案');await page.getByRole('button',{name:'送出訊息',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.discussion-toolbar small')?.textContent==='交叉審查 · 已整理');
 assert(calls.filter(c=>c.id==='p2').some(c=>c.prompt.includes('要審查的指定方案')));
 await mode.selectOption('meeting');slow=true;await page.getByLabel('工作訊息',{exact:true}).fill('開始一場需要插話的討論');await page.getByRole('button',{name:'送出訊息',exact:true}).click();await page.getByLabel('補充給',{exact:true}).waitFor();await page.getByLabel('補充給',{exact:true}).selectOption('p2');await page.getByLabel('工作訊息',{exact:true}).fill('請 Opus 注意新增限制');await page.getByRole('button',{name:'送出訊息（加入待送）',exact:true}).click();
 await page.getByText('請 Opus 注意新增限制',{exact:true}).waitFor();await page.getByRole('button',{name:'停止工作',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.discussion-toolbar small')?.textContent==='多人討論 · 已停止');slow=false;
 await mode.selectOption('normal');await page.getByLabel('工作訊息',{exact:true}).fill('回到單模型，先不要實作');await page.getByRole('button',{name:'送出訊息',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.user-bubble')?.closest('.thread')?.textContent.includes('已帶入前段討論'));
 assert(calls.filter(c=>c.op==='native-send').at(-1).text.includes('回到單模型，先不要實作'));
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'收合側欄',exact:true}).click();await mode.selectOption('meeting');await page.screenshot({path:path.join(out,'discussion-mobile.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 const sendBounds=await page.getByRole('button',{name:'送出訊息',exact:true}).boundingBox();assert(sendBounds.y+sendBounds.height<=844,'expanded mobile settings must leave the send control reachable');
 await writeFile(path.join(out,'ui-result.json'),JSON.stringify({status:'passed',room:a.threadId,errors,checks:['existing room','all modes','all original model messages visible','explicit review target','targeted interjection','whole discussion stop','ordinary handoff','390px no overflow']},null,2));console.log('Discussion desktop/mobile UI passed');
}finally{await browser?.close();await app?.close();}
