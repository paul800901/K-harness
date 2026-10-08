// A read-only view of the navigation target, never a runnable native owner.
export function conversationPreview(record={},history){
 return {threadId:record.threadId??null,model:record.model,title:record.title??'',workspace:record.workspace,provider:history?.provider,
  modelDisplayName:history?.modelDisplayName??record.model,effort:history?.effort??record.effort,efforts:[],inputModalities:[],workerPolicy:record.workerPolicy,serviceTier:history?.serviceTier??record.serviceTier??'default',
 messages:history?.messages??[],tools:[],questions:[],workers:[],artifacts:[],queuedMessages:[],reasoning:[],notices:[],turnDiffs:[],discussion:null,
  parentThreadId:history?.parentThreadId??null,parentTitle:history?.parentTitle??null,
  accessMode:history?.accessMode??record.accessMode,status:'connecting',busy:false,error:null,workerConnection:null,workerError:null,
  goal:null,goalError:'原生目標尚未讀回。',goalPending:false,capabilities:{},browserAccess:{enabled:false,networkAccess:false},
  progress:{plan:[],compactions:null,compactionsComplete:false},connectionOpening:true,historyReady:!!history};
}
