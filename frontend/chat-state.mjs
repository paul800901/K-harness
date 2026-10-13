// Global sidebar/account events must not rebuild the selected chat's native UI.
// Current-room worker details still affect its footer; all other fields retain
// their normal immutable SSE identity, including future fields added to state.
const globalFields=new Set(['conversationActivity','workerActivity','completionAttention','usage','workerDetails']);
export function sameChatState(a,b){
 if(a===b)return true;
 if(!a||!b)return false;
 for(const key of new Set([...Object.keys(a),...Object.keys(b)]))if(!globalFields.has(key)&&a[key]!==b[key])return false;
 if(a.workerDetails===b.workerDetails)return true;
 if(!Array.isArray(a.workerDetails)||!Array.isArray(b.workerDetails))return false;
 const own=s=>s.workerDetails.filter(w=>w.conversationId===s.threadId);
 return JSON.stringify(own(a))===JSON.stringify(own(b));
}
