// Interactive answers only: no default acceptance, no session-wide grant, and
// no collecting secrets through a plain-text terminal.
export async function answerMainQuestion(message, {threadId, ask, show}) {
  if(message.params?.threadId!==threadId)return undefined;
  if(message.method==='mcpServer/elicitation/request') {
    const p=message.params;
    if(p.mode!=='form'||p._meta?.codex_approval_kind!=='mcp_tool_call'||Object.keys(p.requestedSchema?.properties??{}).length)return undefined;
    show(`\nK 操作確認：${p.message}\n${JSON.stringify(p._meta.tool_params,null,2)}\n`);
    const reply=(await ask('只核准這一次？輸入 YES 才核准，其餘拒絕：')).trim();
    return reply==='YES'?{action:'accept',content:{}}:{action:'decline',content:null};
  }
  if(message.method!=='item/tool/requestUserInput')return undefined;
  const questions=message.params.questions;
  if(!Array.isArray(questions)||questions.some(q=>q.isSecret))return undefined;
  const answers={};
  for(const q of questions){
    show(`\nK 需要你確認：${q.question}\n`);
    const options=q.options??[];
    options.forEach((option,index)=>show(`${index+1}. ${option.label} — ${option.description}\n`));
    const raw=(await ask(options.length?'輸入選項編號（空白不核准）：':'輸入回答（空白不回答）：')).trim();
    if(options.length){
      const index=/^[1-9][0-9]*$/u.test(raw)?Number(raw)-1:-1;
      answers[q.id]={answers:index>=0&&index<options.length?[options[index].label]:[]};
    }else answers[q.id]={answers:raw?[raw]:[]};
  }
  return {answers};
}
