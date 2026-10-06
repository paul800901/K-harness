// Presentation telemetry only. Neither a clock tick nor a status/usage read is
// evidence of native work. Saved child observations remain historical only;
// never restore their phase as evidence of a live worker after restart.
export function createWorkActivity(state, now = Date.now) {
 const tools = new Map(),toolStates=new Map();
 const begin = () => { tools.clear();toolStates.clear(); const at=now(); state.activity={startedAt:at,lastEventAt:null,phase:'starting',phaseSince:at}; };
 const record = (phase='active') => {
  if(!state.activity)begin();
  const at=now(),previous=state.activity;
  state.activity={...previous,lastEventAt:at,phase,phaseSince:phase===previous.phase?previous.phaseSince:at};
 };
 const tool = (id,done,kind='tool') => {
  if(!state.activity)begin();
  if(toolStates.get(id)===done)return; // Repeated tool status is not new output.
  toolStates.set(id,done);
  if(done)tools.delete(id);else if(!tools.has(id))tools.set(id,{kind,since:now()});
  const pending=[...tools.values()];
  const phase=pending.some(t=>t.kind==='worker')?'worker':pending.length?'tool':'active';
  record(phase);
  if(pending.length)state.activity.phaseSince=Math.min(...pending.filter(t=>t.kind===phase).map(t=>t.since));
 };
 return {begin,record,tool,clear(){tools.clear();toolStates.clear();state.activity=null;}};
}

// Call only after checking the owning native thread and current turn. Child
// work, replayed history, account updates and transport pings must not refresh it.
export function codexWorkActivity(activity,{method,params:p={}}) {
 if(method==='turn/started'){activity.begin();activity.record();return;}
 if(['item/agentMessage/delta','item/reasoning/summaryTextDelta','item/reasoning/textDelta'].includes(method)&&p.delta){activity.record();return;}
 if(method==='item/commandExecution/outputDelta'&&p.delta){activity.record('tool');return;}
 if(!['item/started','item/completed'].includes(method))return;
 const i=p.item??{},done=method==='item/completed';
 if(['agentMessage','reasoning'].includes(i.type))activity.record();
 else if(i.type==='contextCompaction')activity.record(done?'active':'compacting');
 else if(['mcpToolCall','commandExecution','fileChange','collabAgentToolCall'].includes(i.type))
  activity.tool(i.id,done,i.type==='collabAgentToolCall'&&i.tool==='wait'||/^(?:gemini|luna)_wait$/.test(i.tool??'')?'worker':'tool');
}

export function claudeWorkActivity(activity,message) {
 if(message.isReplay||message.parent_tool_use_id)return;
 if(message.type==='stream_event'){
  const e=message.event;
  if(e?.type==='message_start'||['content_block_start','content_block_delta'].includes(e?.type))activity.record();
 }else if(message.type==='assistant'){
  activity.record();
  for(const block of message.message?.content??[])if(block.type==='tool_use')
   activity.tool(block.id,false,/^(?:Agent|Task|.*__(?:luna|gemini)_wait)$/.test(block.name??'')?'worker':'tool');
 }else if(message.type==='user'){
  const blocks=message.message?.content;
  for(const block of Array.isArray(blocks)?blocks:[])if(block.type==='tool_result')activity.tool(block.tool_use_id,true);
 }else if(message.type==='system'&&message.subtype==='status'&&message.status==='compacting')activity.record('compacting');
 else if(message.type==='system'&&message.subtype==='compact_boundary')activity.record();
 // tool_progress is an elapsed-time pulse, not proof of tool output.
}

export function geminiWorkActivity(activity,event) {
 const step=event.step_update;
 if(step?.tool_info)activity.tool(String(step.step_index),step.state==='DONE'||!!step.tool_info.error);
 else if(step?.text_delta)activity.record();
}
