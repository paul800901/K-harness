export const discussionModes={parallel:'平行比較',review:'交叉審查',meeting:'多人討論'};
export const discussionStatus={preparing:'整理背景',working:'討論中',finishing:'整理完成中',stopping:'停止中',completed:'已整理',interrupted:'已停止',failed:'討論受阻',uncertain:'結果待確認'};

// Validate only the instruction K must execute, not model prose or an imagined
// universal workflow. Invalid instructions remain visible errors, never retries.
export function discussionDecision(text,participants){
 const value=JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/u,'$1'));
 if(value.action==='finish'&&typeof value.summary==='string'&&value.summary.trim())return value;
 if(value.action==='speak'&&Array.isArray(value.speakers)&&value.speakers.length&&new Set(value.speakers).size===value.speakers.length&&
    value.speakers.every(id=>participants.some(p=>p.id===id))&&typeof value.prompt==='string'&&value.prompt.trim())return value;
 throw Error('主持人的調度指令無法辨識；保留已有發言，沒有自動重試。');
}

export function discussionTranscript(messages){return messages.map(({role,speaker,text,displayText,partial,streaming,target,attachments})=>({role,speaker,text:displayText??text,...(partial||streaming?{partial:true}:{}),...(target?{target}:{}),...(attachments?.length?{attachments:attachments.map(({id,name,kind,warning})=>({id,name,kind,warning}))}:{})}));}
