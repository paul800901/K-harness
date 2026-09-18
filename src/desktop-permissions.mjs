export function permissionMode(value='workspace-write') {
 if(!['read-only','workspace-write','auto-review','danger-full-access'].includes(value))throw new Error('請選擇有效的存取模式。');
 return value;
}

export function turnPermissions(mode,workspace) {
 const access=permissionMode(mode);
 return {
  approvalPolicy:access==='danger-full-access'?'never':'on-request',
  approvalsReviewer:access==='auto-review'?'auto_review':'user',
  sandboxPolicy:access==='read-only'?{type:'readOnly'}:access==='danger-full-access'?{type:'dangerFullAccess'}:{type:'workspaceWrite',writableRoots:[workspace],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true},
 };
}

export function threadPermissions(mode,workspace) {
 const access=permissionMode(mode),turn=turnPermissions(access,workspace);
 const sandbox=access==='danger-full-access'?'danger-full-access':access==='read-only'?'read-only':'workspace-write';
 return {
  approvalPolicy:turn.approvalPolicy,
  approvalsReviewer:turn.approvalsReviewer,
  sandbox,
  config:{
   approval_policy:turn.approvalPolicy,
   approvals_reviewer:turn.approvalsReviewer,
   sandbox_mode:sandbox,
   ...((access==='workspace-write'||access==='auto-review')?{sandbox_workspace_write:{writable_roots:[workspace],network_access:false,exclude_tmpdir_env_var:true,exclude_slash_tmp:true}}:{}),
  },
 };
}

// Match the installed app-server protocol. A UI click grants only the displayed
// request, never a remembered command prefix, network rule or session grant.
export function approvalRequest(message,item) {
 const p=message.params??{}, method=message.method;
 if(method==='mcpServer/elicitation/request'&&p.mode==='form'&&p._meta?.codex_approval_kind==='mcp_tool_call'&&!Object.keys(p.requestedSchema?.properties??{}).length){
  return {title:'外部工具需要核准',text:p.message,details:p._meta.tool_params,server:p.serverName,acceptLabel:'只核准這一次',canAccept:true,
   reply:accept=>({action:accept?'accept':'decline',content:accept?{}:null}),cancel:()=>({action:'cancel',content:null})};
 }
 if(method==='item/commandExecution/requestApproval'){
  const choices=p.availableDecisions??['accept','decline','cancel'];
  const details={command:p.command??item?.command,cwd:p.cwd??item?.cwd,kind:p.kind??'command',network:p.networkApprovalContext,additionalPermissions:p.additionalPermissions};
  return {title:p.networkApprovalContext?'需要網路存取核准':p.kind==='writeStdin'?'需要終端輸入核准':'需要執行命令核准',text:p.reason??'請確認以下實際操作。',details,canAccept:choices.includes('accept'),acceptLabel:'只核准這一次',
   reply:accept=>{if(accept&&!choices.includes('accept'))throw new Error('此請求不提供單次核准，未擴大為永久權限。');return {decision:accept?'accept':choices.includes('decline')?'decline':'cancel'};},cancel:()=>({decision:'cancel'})};
 }
 if(method==='item/fileChange/requestApproval'){
  return {title:'需要修改檔案核准',text:p.reason??'請確認以下檔案與變更內容。',details:{changes:item?.changes??[],requestedRoot:p.grantRoot??null},canAccept:!!item?.changes?.length,acceptLabel:'只核准這次變更',
   reply:accept=>{if(accept&&!item?.changes?.length)throw new Error('缺少實際變更內容，不能核准。');return {decision:accept?'accept':'decline'};},cancel:()=>({decision:'cancel'})};
 }
 if(method==='item/permissions/requestApproval'&&p.permissions&&typeof p.permissions==='object'){
  const requested=structuredClone(p.permissions);
  return {title:'需要額外存取權限',text:p.reason??'只在目前回合授予下列存取範圍；不是單一命令核准。',details:{cwd:p.cwd,permissions:requested,scope:'turn'},canAccept:true,acceptLabel:'僅本回合核准',
   reply:accept=>({permissions:accept?requested:{},scope:'turn'}),cancel:()=>({permissions:{},scope:'turn'})};
 }
 return null;
}
