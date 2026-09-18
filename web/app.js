const $=id=>document.getElementById(id);
const labels={idle:'尚未開啟',connecting:'連線中',ready:'可以開始',working:'工作中',completed:'回合完成',interrupted:'已中止',failed:'回合失敗',error:'連線失敗',offline:'後端離線',uncertain:'結果未確認'};
const workerLabels={running:'執行中',completed:'工人已結束，需另行驗收',cancelled:'已取消',failed:'失敗',unresolved:'狀態未確認，不要重派',unavailable:'無法查明'};
let state={},online=true,busyAction=false,questionKey='',sessionKey='';
function error(e){$('error').textContent=e.message??String(e);$('error').hidden=false;}
async function api(route,data){const res=await fetch(`/api/${route}`,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-K-Request':'1'},body:JSON.stringify(data)});const value=await res.json();if(!res.ok)throw new Error(value.error);return value;}
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
async function action(fn){if(busyAction)return;busyAction=true;renderControls();try{await fn();}catch(e){error(e);}finally{busyAction=false;renderControls();}}
function renderControls(){
 const busy=state.busy||state.status==='connecting';
 $('new').disabled=!online||busy||busyAction;$('model').disabled=busy||busyAction;
 $('send').disabled=!online||busy||busyAction||!['ready','completed','interrupted','failed'].includes(state.status);
 $('stop').disabled=!online||!state.busy;$('workers').disabled=!online||!state.threadId||state.status==='connecting';
 $('shutdown').disabled=!online||state.status==='connecting';
 for(const b of $('sessions').querySelectorAll('button'))b.disabled=!online||busy||busyAction;
}
async function sessions(){const {sessions,unreadable}=await api('sessions');$('sessions').replaceChildren();for(const s of sessions){const b=element('button',s.model==='gpt-6-astra'?'Astra 對話':'Sol 對話','session'+(s.threadId===state.threadId?' active':''));b.append(element('small',new Date(s.lastOpenedAt).toLocaleString('zh-TW')),element('small',s.threadId.slice(0,18)+'…'));b.title=s.threadId;b.onclick=()=>action(()=>api('open',{model:s.model,threadId:s.threadId}));$('sessions').append(b);}if(!sessions.length)$('sessions').append(element('small','尚無已保存對話。'));if(unreadable)$('sessions').append(element('small',`${unreadable} 份紀錄無法讀取，已保留。`));renderControls();}
function questions(){
 const key=JSON.stringify(state.questions);if(key===questionKey)return;questionKey=key;$('questions').replaceChildren();
 for(const q of state.questions??[]){const box=element('div',undefined,'question');box.append(element('strong',q.kind==='approval'?'需要你的核准':'需要你的回答'));
  if(q.kind==='approval'){
   box.append(element('p',q.text),element('pre',JSON.stringify(q.details,null,2)));
   for(const [text,accept] of [['拒絕',false],['只核准這一次',true]]){const b=element('button',text,accept?'approve':'secondary');b.onclick=()=>action(()=>api('answer',{id:q.id,accept}));box.append(b);}
  }else{
   const fields=[];for(const question of q.questions){const label=element('label',question.question);const field=element(question.options?.length?'select':'input');if(question.options?.length){const blank=element('option','請選擇（不預選）');blank.value='';field.append(blank);for(const o of question.options){const option=element('option',o.label);option.value=o.label;field.append(option);}}label.append(field);box.append(label);fields.push([question.id,field]);}
   const b=element('button','送出回答','approve');b.onclick=()=>action(()=>api('answer',{id:q.id,answers:Object.fromEntries(fields.map(([id,f])=>[id,f.value]))}));box.append(b);
  }$('questions').append(box);
 }
}
function render(next){state=next;$('status').textContent=labels[state.status]??state.status;$('active-model').textContent=state.model==='gpt-6-astra'?'GPT-6 Astra':state.model==='gpt-5.6-sol'?'GPT-5.6 Sol':'尚未開啟對話';$('heading').textContent=state.threadId?'工作對話':'準備開始工作';$('heading').title=state.threadId??'';
 if(state.error)error(state.error);else $('error').hidden=true;
 $('welcome').hidden=!!state.threadId;
 const scroller=$('conversation'),atBottom=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<100;
 const existing=new Map([...$('messages').children].map(e=>[e.dataset.id,e]));
 for(const m of state.messages??[]){let node=existing.get(m.id);if(!node){node=element('article',undefined,`message ${m.role}`);node.dataset.id=m.id;node.append(element('div',m.role==='user'?'你':'主代理','role'),element('div','','message-body'));$('messages').append(node);}node.lastChild.textContent=m.text;existing.delete(m.id);}for(const node of existing.values())node.remove();if(atBottom)scroller.scrollTop=scroller.scrollHeight;
 questions();$('worker-list').replaceChildren();for(const w of state.workers??[]){const node=element('div',`${w.requestId} · ${workerLabels[w.status]??w.status}`,'worker');for(const a of w.artifacts??[])node.append(element('pre',`${a.path}\n${{present:'檔案存在，未判定正確',missing:'檔案不存在',unavailable:'無法確認'}[a.observation]}`));$('worker-list').append(node);}if(!state.workers?.length)$('worker-list').textContent='尚無查詢結果；按「查詢」讀取原工作。';
 $('tools').replaceChildren();for(const t of (state.tools??[]).slice(-12))$('tools').append(element('div',`${t.name} · ${t.status}`,'tool'));if(!state.tools?.length)$('tools').textContent='工具活動會在此顯示。';
 renderControls();const key=`${state.threadId}/${state.status==='ready'}`;if(key!==sessionKey){sessionKey=key;sessions().catch(error);}
}
$('new').onclick=()=>action(()=>api('open',{model:$('model').value}));$('refresh').onclick=()=>sessions().catch(error);
$('compose').onsubmit=e=>{e.preventDefault();if($('send').disabled)return;const text=$('prompt').value;if(!text.trim())return;action(async()=>{await api('send',{text});$('prompt').value='';});};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('compose').requestSubmit();}};
$('stop').onclick=()=>action(()=>api('stop',{}));$('workers').onclick=()=>action(()=>api('workers',{}));
$('shutdown').onclick=()=>{if(confirm('停止 K 後端？目前主回合與可確認的工人將中止，已寫出的檔案保留。'))action(async()=>{await api('shutdown',{});events.close();online=false;$('status').textContent='後端已停止';renderControls();});};
const events=new EventSource('/api/events');events.onmessage=e=>{online=true;render(JSON.parse(e.data));};events.onerror=()=>{online=false;$('status').textContent='連線中斷';error('介面與後端暫時斷線。工作不會自動重送；可重開桌面啟動器。');renderControls();};
sessions().catch(error);
