// Session-local presentation state: never infer completion from saved history
// or a child's result. A fresh main turn must have actually run in this process.
export function createCompletionAttention(){
 const runs=new Map(),unread=new Map();let sequence=0;
 return {
  observe(state){
   const id=state.threadId;if(!id)return;
   let run=runs.get(id);
   if(state.status==='working'&&state.busy){
    if(!run)runs.set(id,run={});
    run.armed=true;run.waitingForMain=false;
    unread.delete(id);return;
   }
   if(!run?.armed)return;
   if(['failed','interrupted','stopping','offline','error','uncertain'].includes(state.status)){run.armed=false;return;}
   if(state.status!=='completed'||state.busy)return;
   if(state.completionPending||state.goalError||['starting','active','unknown'].includes(state.goal?.status))return;
   const waiting=(state.workers??[]).some(w=>w.settled===false||
    (w.settled!==true&&!['completed','failed','cancelled','canceled','stopped','interrupted'].includes(w.status)));
   if(waiting){run.waitingForMain=true;return;}
   // A child settling is not the parent's final response. Wait for the parent
   // to resume and finish rather than announce its earlier waiting message.
   if(run.waitingForMain||state.workerConnection==='failed'||state.questions?.length||state.queuedMessages?.length||state.error)return;
   run.armed=false;unread.set(id,++sequence);
  },
  get state(){return {sequence,unread:[...unread].map(([threadId,sequence])=>({threadId,sequence}))};},
  markViewed({threadId,sequence:seen}={}){
   // A delayed acknowledgement must not clear a newer completion.
   if(unread.has(threadId)&&unread.get(threadId)===seen){unread.delete(threadId);return true;}
   return false;
  },
  forget(id){runs.delete(id);unread.delete(id);},
 };
}
