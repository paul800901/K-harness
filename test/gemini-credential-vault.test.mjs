import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {createGeminiCredentialVault} from '../src/gemini-credential-vault.mjs';

const execFileAsync=promisify(execFile);
const root='a'.repeat(64),email='person@example.test',accountId=createHash('sha256').update(email).digest('hex').slice(0,32);
const metadata={accountId,email};

test('disabled vault refuses all operations before invoking the Windows helper',async()=>{
 let calls=0;const vault=createGeminiCredentialVault({root,env:{SystemRoot:'C:\\Windows'},enabled:false,execImpl:async()=>{calls++;return {stdout:'null'};}});
 await assert.rejects(vault.current(),/尚未啟用/u);await assert.rejects(vault.capture(),/尚未啟用/u);await assert.rejects(vault.activate(accountId),/尚未啟用/u);await assert.rejects(vault.prepareLogin(),/尚未啟用/u);await assert.rejects(vault.assertIdle(),/尚未啟用/u);assert.equal(calls,0);
});

test('public operations use only safe metadata and pass no secret through helper arguments',async()=>{
 const calls=[];const vault=createGeminiCredentialVault({root,env:{SystemRoot:'C:\\Windows'},enabled:true,execImpl:async(file,args,options)=>{
  calls.push({file,args,options});const op=args[args.indexOf('-Operation')+1];
  return {stdout:JSON.stringify(op==='assertIdle'?{idle:true}:metadata)};
 }});
 assert.deepEqual(await vault.current(),metadata);assert.deepEqual(await vault.capture(),metadata);assert.deepEqual(await vault.activate(accountId),metadata);assert.deepEqual(await vault.activate(accountId,{preserveCurrent:false}),metadata);assert.deepEqual(await vault.prepareLogin(),{previousAccountId:accountId});
 for(const call of calls){assert.equal(isAbsolute(call.file),true);assert.equal(call.args.includes(email),false);assert.equal(call.args.includes('refresh-token-secret'),false);assert.equal(call.args.includes('credential-blob-secret'),false);assert.equal(call.options.windowsHide,true);assert.equal(call.options.encoding,'utf8');}
 assert.equal(calls.filter(call=>call.args.includes('-Operation')&&call.args[call.args.indexOf('-Operation')+1]==='assertIdle').length,4);
 const activations=calls.filter(call=>call.args.includes('-Operation')&&call.args[call.args.indexOf('-Operation')+1]==='activate');
 assert.equal(activations[0].args.includes('-SkipCaptureCurrent'),false);assert.equal(activations[1].args.includes('-SkipCaptureCurrent'),true);
});

test('malformed or secret-like helper output is rejected without becoming public metadata',async()=>{
 const vault=createGeminiCredentialVault({root,env:{SystemRoot:'C:\\Windows'},enabled:true,execImpl:async()=>({stdout:JSON.stringify({email,accountId,token:'should-not-pass'})})});
 // Additional fields are not returned to callers.
 assert.deepEqual(await vault.current(),metadata);
 const bad=createGeminiCredentialVault({root,env:{SystemRoot:'C:\\Windows'},enabled:true,execImpl:async()=>({stdout:JSON.stringify({email,accountId:'0'.repeat(32)})})});
 await assert.rejects(bad.current(),/中繼資料無效/u);
});

test('safe helper error codes preserve busy and identity explanations without exposing stderr',async()=>{
 const busy=createGeminiCredentialVault({root,env:{SystemRoot:'C:\\Windows'},enabled:true,execImpl:async()=>{throw Object.assign(new Error('native details'),{stdout:'{"errorCode":"busy"}',stderr:'secret-bearing stderr'});}});
 await assert.rejects(busy.capture(),/Antigravity 正在執行/u);
 const identity=createGeminiCredentialVault({root,env:{SystemRoot:'C:\\Windows'},enabled:true,execImpl:async()=>{throw Object.assign(new Error('native details'),{stdout:'{"errorCode":"identity"}',stderr:'secret-bearing stderr'});}});
 await assert.rejects(identity.current(),/憑證身分缺失或不唯一/u);
});

test('helper is restricted to the exact live target and contains no credential enumeration or logout path',async()=>{
 const helper=await readFile(fileURLToPath(new URL('../scripts/gemini-credentials.ps1',import.meta.url)),'utf8');
 assert.match(helper,/\$liveTarget='antigravity\.gemini'/u);assert.match(helper,/CredReadW/u);assert.match(helper,/CredWriteW/u);assert.match(helper,/CredDeleteW/u);
 assert.doesNotMatch(helper,/CredEnumerateW|\/logout|\.gemini[\\/]|Chrome|Get-ChildItem.*Credential/iu);
 assert.match(helper,/Get-Process/u);assert.doesNotMatch(helper,/Win32_Process|CommandLine|Kill\(/u);
});

test('PowerShell 5.1 executes identity parsing and hashing on fake UTF-16 blobs only',{skip:process.platform!=='win32'},async()=>{
 const helper=fileURLToPath(new URL('../scripts/gemini-credentials.ps1',import.meta.url));
 const helperB64=Buffer.from(helper,'utf8').toString('base64');
 const valid=Buffer.from(JSON.stringify({profile:{displayName:'王小明',identity:{email:'User@example.test'}}}),'utf16le').toString('base64');
 const ambiguous=Buffer.from(JSON.stringify({a:{email:'one@example.test'},b:{nested:{email_address:'two@example.test'}}}),'utf16le').toString('base64');
 const missing=Buffer.from(JSON.stringify({profile:{displayName:'王小明'}}),'utf16le').toString('base64');
 const expected=createHash('sha256').update('user@example.test').digest('hex').slice(0,32);
 const command=String.raw`
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'Expected Windows PowerShell 5.1.'}
$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${helperB64}'))
$tokens=$null;$parseErrors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'PowerShell parse failed.'}
$nativeAst=$ast.Find({param($n)$n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and $n.Left.VariablePath.UserPath -eq 'native'},$true)
if($null -eq $nativeAst -or $nativeAst.Right -isnot [System.Management.Automation.Language.CommandExpressionAst] -or $nativeAst.Right.Expression -isnot [System.Management.Automation.Language.StringConstantExpressionAst]){throw 'Native source was not a literal.'}
$functions=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in @('Get-Email','Get-AccountId')},$true)
foreach($function in $functions){Invoke-Expression $function.Extent.Text}
Add-Type -TypeDefinition $nativeAst.Right.Expression.Value -ErrorAction Stop
$valid=[PSCustomObject]@{Blob=[Convert]::FromBase64String('${valid}')}
$ambiguous=[PSCustomObject]@{Blob=[Convert]::FromBase64String('${ambiguous}')}
$missing=[PSCustomObject]@{Blob=[Convert]::FromBase64String('${missing}')}
$email=Get-Email $valid;$accountId=Get-AccountId $email;$upper=Get-AccountId 'USER@example.test'
$ambiguousRejected=$false;try{Get-Email $ambiguous|Out-Null}catch{$ambiguousRejected=$_.Exception.Message -like 'IDENTITY:*'}
$missingRejected=$false;try{Get-Email $missing|Out-Null}catch{$missingRejected=$_.Exception.Message -like 'IDENTITY:*'}
[Console]::Out.WriteLine((ConvertTo-Json -Compress @{email=$email;accountId=$accountId;upperAccountId=$upper;ambiguousRejected=$ambiguousRejected;missingRejected=$missingRejected}))
`;
 const encoded=Buffer.from(command,'utf16le').toString('base64');
 const ps=await execFileAsync(`${process.env.SystemRoot??'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:4096});
 const result=JSON.parse(ps.stdout.trim());
 assert.deepEqual(result,{email:'user@example.test',accountId:expected,upperAccountId:expected,ambiguousRejected:true,missingRejected:true});
});
