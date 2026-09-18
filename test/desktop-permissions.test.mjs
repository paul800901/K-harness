import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalRequest,permissionMode,threadPermissions,turnPermissions} from '../src/desktop-permissions.mjs';

test('permission selection recognizes the four explicit desktop modes',()=>{
 assert.equal(permissionMode(),'workspace-write');
 for(const mode of ['read-only','workspace-write','auto-review','danger-full-access'])assert.equal(permissionMode(mode),mode);
 for(const mode of ['externalSandbox','',null])assert.throws(()=>permissionMode(mode));
});

test('thread and turn permissions preserve workspace boundaries and match reviewer settings',()=>{
 const root='D:/test';
 const read=turnPermissions('read-only',root);
 assert.deepEqual(read,{approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'readOnly'}});
 const write=turnPermissions('workspace-write',root);
 assert.deepEqual(write,{approvalPolicy:'on-request',approvalsReviewer:'user',sandboxPolicy:{type:'workspaceWrite',writableRoots:[root],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}});
 const review=threadPermissions('auto-review',root);
 assert.equal(review.approvalPolicy,'on-request');assert.equal(review.approvalsReviewer,'auto_review');assert.equal(review.sandbox,'workspace-write');
 assert.deepEqual(review.config.sandbox_workspace_write,{writable_roots:[root],network_access:false,exclude_tmpdir_env_var:true,exclude_slash_tmp:true});
 assert.equal(review.config.approvals_reviewer,'auto_review');
 const danger=threadPermissions('danger-full-access',root);
 assert.deepEqual(turnPermissions('danger-full-access',root),{approvalPolicy:'never',approvalsReviewer:'user',sandboxPolicy:{type:'dangerFullAccess'}});
 assert.equal(danger.sandbox,'danger-full-access');assert.equal(danger.approvalPolicy,'never');assert.equal(danger.approvalsReviewer,'user');
 assert.equal(danger.config.sandbox_mode,'danger-full-access');assert.equal('sandbox_workspace_write' in danger.config,false);
});
test('command approval does not substitute remembered or persistent approval decisions',()=>{
 const q=approvalRequest({method:'item/commandExecution/requestApproval',params:{command:'test',availableDecisions:['acceptForSession','decline']}});
 assert.equal(q.canAccept,false);assert.throws(()=>q.reply(true));assert.deepEqual(q.reply(false),{decision:'decline'});
 const net=approvalRequest({method:'item/commandExecution/requestApproval',params:{networkApprovalContext:{host:'example.test',protocol:'https'}}});
 assert.equal(net.title,'需要網路存取核准');assert.deepEqual(net.details.network,{host:'example.test',protocol:'https'});
});
test('file approval requires actual diff and permissions grants only the displayed request for this turn',()=>{
 const q=approvalRequest({method:'item/fileChange/requestApproval',params:{itemId:'missing'}});
 assert.equal(q.canAccept,false);assert.throws(()=>q.reply(true));assert.deepEqual(q.reply(false),{decision:'decline'});
 const permissions={fileSystem:{write:['D:/test/one.txt']}};
 const grant=approvalRequest({method:'item/permissions/requestApproval',params:{permissions,cwd:'D:/test'}});
 permissions.fileSystem.write.push('D:/other');
 assert.deepEqual(grant.reply(true),{permissions:{fileSystem:{write:['D:/test/one.txt']}},scope:'turn'});
 assert.deepEqual(grant.reply(false),{permissions:{},scope:'turn'});
});
