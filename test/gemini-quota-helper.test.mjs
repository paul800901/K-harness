import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const quotaPath = fileURLToPath(new URL('../scripts/gemini-quota.ps1', import.meta.url));
const credentialsPath = fileURLToPath(new URL('../scripts/gemini-credentials.ps1', import.meta.url));

async function runWindowsPowerShell(source) {
  const command = String.raw`
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'Expected Windows PowerShell 5.1.'}
Add-Type -AssemblyName System.Net.Http
Add-Type -TypeDefinition @'
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
public sealed class KQuotaFakeHttpHandler : HttpMessageHandler {
 public static int Status=400; public static string Body="{}";
 public static string UserAgent="", Uri=""; public static bool MatchCli=false;
 protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token){
  IEnumerable<string> values;UserAgent=request.Headers.TryGetValues("User-Agent",out values)?string.Join(" ",values):"";Uri=request.RequestUri.ToString();
  string body=MatchCli&&!UserAgent.StartsWith("antigravity/cli/")?"{\"groups\":[{\"buckets\":[{\"bucketId\":\"3p-weekly\",\"remainingFraction\":1}]}]}":Body;
  return Task.FromResult(new HttpResponseMessage((HttpStatusCode)Status){Content=new StringContent(body)});
 }
}
public static class KGeminiCredentialNative {
 public sealed class Record { public byte[] Blob; }
 public static Dictionary<string,Record> Store=new Dictionary<string,Record>(); public static int Writes=0;
 public static Record Read(string target){Record r;if(!Store.TryGetValue(target,out r))return null;return new Record{Blob=(byte[])r.Blob.Clone()};}
 public static void Write(string target,Record record,uint persistence){Writes++;Store[target]=new Record{Blob=(byte[])record.Blob.Clone()};}
 public static bool EqualBytes(byte[] a,byte[] b){if(a==null||b==null||a.Length!=b.Length)return false;for(int i=0;i<a.Length;i++)if(a[i]!=b[i])return false;return true;}
 public static void ClearRecord(Record record){}
}
'@ -ReferencedAssemblies @([Net.Http.HttpClient].Assembly.Location)
foreach($pair in @(@('${quotaPath.replaceAll("'", "''")}',@('Get-GeminiQuotaBuckets','Get-ManagedGeminiQuota','Get-InstalledGeminiClient','Get-InstalledGeminiUserAgent','Invoke-GeminiQuotaHttp')), @('${credentialsPath.replaceAll("'", "''")}',@('Write-SafeJson','Save-CurrentManaged')))){
 $tokens=$null;$parseErrors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile($pair[0],[ref]$tokens,[ref]$parseErrors)
 if($parseErrors.Count){throw 'PowerShell source parse failed.'}
 foreach($name in $pair[1]){$node=$ast.Find({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);if($null -eq $node){throw "Expected function missing: $name"};$functionText=$node.Extent.Text;if($name -eq 'Invoke-GeminiQuotaHttp'){$functionText=$functionText.Replace('$handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false','$handler=[KQuotaFakeHttpHandler]::new()')};Invoke-Expression $functionText}
}
$script:installedUserAgent=(Get-Item Function:Get-InstalledGeminiUserAgent).ScriptBlock
function Get-InstalledGeminiUserAgent([string]$Executable){if($Executable -eq 'fake.exe'){return 'antigravity/cli/1.4.0'};return & $script:installedUserAgent $Executable}
${source}
`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const ps = await execFileAsync(
    `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    {windowsHide: true, encoding: 'utf8', timeout: 20000, maxBuffer: 8192}
  );
  return ps.stdout
    .trim()
    .split(/\r?\n/u)
    .map(line => JSON.parse(line));
}

test(
  'quota response schemas accept documented fractions and disabled forms, and reject missing windows',
  {skip: process.platform !== 'win32'},
  async () => {
    const result = await runWindowsPowerShell(String.raw`
$fraction=ConvertFrom-Json '{"buckets":[{"id":"gemini-5h","remainingFraction":0.375,"resetTime":"2026-10-13T01:00:00Z"},{"id":"gemini-weekly","remaining":{"case":"remainingFraction","value":0.625}}]}'
$nested=ConvertFrom-Json '{"quotas":{"gemini-5h":{"remaining":{"remainingFraction":0.25}},"gemini-weekly":{"remaining":{"case":"disabled"}}}}'
$missing=ConvertFrom-Json '{"buckets":[{"id":"gemini-5h","remainingFraction":0.5}]}'
$a=@(Get-GeminiQuotaBuckets $fraction);$b=@(Get-GeminiQuotaBuckets $nested)
function Get-InstalledGeminiClient([string]$Executable){return @{id='fake-client';secret='fake-client-secret'}}
function Invoke-GeminiQuotaHttp([string]$Uri,[string]$Token,$Form){return $script:payload}
$schemaRejected=$false
try{$script:payload=$missing;Get-ManagedGeminiQuota ([PSCustomObject]@{Blob=[Text.Encoding]::UTF8.GetBytes('{"token":{"access_token":"fake-access","expiry":"2099-01-01T00:00:00Z"}}')}) 'fake.exe' $null $false|Out-Null}catch{$schemaRejected=$_.Exception.Message -like 'QUOTA_SCHEMA:*'}
Write-SafeJson @{fraction=$a;disabled=$b;missingRejected=$schemaRejected}
`);
    assert.equal(result.length, 1);
    assert.deepEqual(
      result[0].fraction.map(({id, remainingPercent, disabled, resetsAt}) => ({
        id,
        remainingPercent,
        disabled,
        resetsAt
      })),
      [
        {id: 'gemini-5h', remainingPercent: 37.5, disabled: false, resetsAt: 1791853200},
        {id: 'gemini-weekly', remainingPercent: 62.5, disabled: false, resetsAt: null}
      ]
    );
    assert.deepEqual(
      result[0].disabled.map(({id, remainingPercent, disabled}) => ({id, remainingPercent, disabled})),
      [
        {id: 'gemini-5h', remainingPercent: 25, disabled: false},
        {id: 'gemini-weekly', remainingPercent: null, disabled: true}
      ]
    );
    assert.equal(result[0].missingRejected, true);
  }
);

test('independent quota identifies the selected CLI and rejects a third-party-only response',
  {skip: process.platform !== 'win32'}, async () => {
    const [result] = await runWindowsPowerShell(String.raw`
[KQuotaFakeHttpHandler]::Status=200;[KQuotaFakeHttpHandler]::MatchCli=$true
[KQuotaFakeHttpHandler]::Body='{"groups":[{"buckets":[{"bucketId":"gemini-weekly","remainingFraction":0.625},{"bucketId":"gemini-5h","remainingFraction":1}]},{"buckets":[{"bucketId":"3p-weekly","remainingFraction":0.8}]}]}'
$record=[PSCustomObject]@{Blob=[Text.Encoding]::UTF8.GetBytes('{"token":{"access_token":"fake-access","expiry":"2099-01-01T00:00:00Z"}}')}
$quota=Get-ManagedGeminiQuota $record 'fake.exe' $null $false
$ua=[KQuotaFakeHttpHandler]::UserAgent;$uri=[KQuotaFakeHttpHandler]::Uri
[KQuotaFakeHttpHandler]::Body='{"groups":[{"buckets":[{"bucketId":"3p-weekly","remainingFraction":1},{"bucketId":"3p-5h","remainingFraction":1}]}]}'
$rejected=$false;try{Get-ManagedGeminiQuota $record 'fake.exe' $null $false|Out-Null}catch{$rejected=$_.Exception.Message -like 'QUOTA_SCHEMA:*'}
$badVersion=$false;try{Get-InstalledGeminiUserAgent 'missing-quota-probe.exe'|Out-Null}catch{$badVersion=$_.Exception.Message -like 'QUOTA_CLIENT:*'}
Write-SafeJson @{userAgent=$ua;uri=$uri;windows=$quota.windows;thirdPartyRejected=$rejected;missingVersionRejected=$badVersion}
`);
    assert.equal(result.userAgent, 'antigravity/cli/1.4.0');
    assert.equal(result.uri, 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary');
    assert.deepEqual(result.windows.map(w => [w.key, w.remainingPercent]), [['five_hour', 100], ['seven_day', 62.5]]);
    assert.equal(result.thirdPartyRejected, true);
    assert.equal(result.missingVersionRejected, true);
  });

test(
  'a quota 401 triggers exactly one refresh, and refreshed tokens are saved before later quota failure',
  {skip: process.platform !== 'win32'},
  async () => {
    const result = await runWindowsPowerShell(String.raw`
function Get-InstalledGeminiClient([string]$Executable){return @{id='fake-client';secret='fake-client-secret'}}
$script:quotaCalls=0;$script:refreshCalls=0;$script:savedTokens=New-Object 'System.Collections.Generic.List[string]';$script:payload=ConvertFrom-Json '{"buckets":[{"id":"gemini-5h","remainingFraction":0.5},{"id":"gemini-weekly","remainingFraction":0.25}]}'
function Invoke-GeminiQuotaHttp([string]$Uri,[string]$Token,$Form){if($Form){$script:refreshCalls++;return @{access_token='rotated-access';refresh_token='rotated-refresh';expires_in=3600}};$script:quotaCalls++;if($script:quotaCalls -eq 1){throw 'QUOTA_AUTH:expired'};return $script:payload}
$blob=[Text.Encoding]::UTF8.GetBytes('{"token":{"access_token":"old-access","refresh_token":"old-refresh","expiry":"2099-01-01T00:00:00Z"}}')
$record=[PSCustomObject]@{Blob=$blob};$saveRefresh={param($data)[void]$script:savedTokens.Add($data.token.refresh_token)}
$success=Get-ManagedGeminiQuota $record 'fake.exe' $saveRefresh $false
$successState=@{quotaCalls=$script:quotaCalls;refreshCalls=$script:refreshCalls;refreshed=$success.refreshed;refreshToken=$script:savedTokens[0];accessToken=$success.updatedData.token.access_token}
$script:quotaCalls=0;$script:refreshCalls=0;$script:savedTokens=New-Object 'System.Collections.Generic.List[string]'
function Invoke-GeminiQuotaHttp([string]$Uri,[string]$Token,$Form){if($Form){$script:refreshCalls++;return @{access_token='rotated-access';refresh_token='rotated-refresh';expires_in=3600}};$script:quotaCalls++;throw 'QUOTA_SCHEMA:fake missing quota fields'}
$failed=$false
try{Get-ManagedGeminiQuota $record 'fake.exe' $saveRefresh $true|Out-Null}catch{$failed=$_.Exception.Message -like 'QUOTA_SCHEMA:*'}
Write-SafeJson @{success=$successState;laterFailure=$failed;savedBeforeFailure=$script:savedTokens[0];refreshCallsOnFailure=$script:refreshCalls}
`);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      success: {
        quotaCalls: 2,
        refreshCalls: 1,
        refreshed: true,
        refreshToken: 'rotated-refresh',
        accessToken: 'rotated-access'
      },
      laterFailure: true,
      savedBeforeFailure: 'rotated-refresh',
      refreshCallsOnFailure: 1
    });
    assert.doesNotMatch(JSON.stringify(result), /fake-client-secret|old-access|old-refresh/u);
  }
);

test(
  'capture preserves same-login managed refresh tokens and accepts a new login identity',
  {skip: process.platform !== 'win32'},
  async () => {
    const result = await runWindowsPowerShell(String.raw`
$target='fake-managed-account'
$managed=[KGeminiCredentialNative+Record]::new();$managed.Blob=[Text.Encoding]::UTF8.GetBytes('{"id_token":"same-login","token":{"expiry":"2026-10-13T00:00:00Z","refresh_token":"rotated-managed"}}')
$live=[KGeminiCredentialNative+Record]::new();$live.Blob=[Text.Encoding]::UTF8.GetBytes('{"id_token":"same-login","token":{"expiry":"2026-10-13T00:00:00Z","refresh_token":"older-live"}}')
[KGeminiCredentialNative]::Store[$target]=$managed;Save-CurrentManaged $live $target
$sameWrites=[KGeminiCredentialNative]::Writes;$same=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([KGeminiCredentialNative]::Read($target).Blob))
$newLogin=[KGeminiCredentialNative+Record]::new();$newLogin.Blob=[Text.Encoding]::UTF8.GetBytes('{"id_token":"new-login","token":{"expiry":"2026-10-13T00:00:00Z","refresh_token":"new-login-token"}}')
Save-CurrentManaged $newLogin $target
$fresh=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([KGeminiCredentialNative]::Read($target).Blob))
Write-SafeJson @{writesAfterSame=$sameWrites;managedRefreshAfterSame=$same.token.refresh_token;writesAfterNew=[KGeminiCredentialNative]::Writes;freshId=$fresh.id_token;freshRefresh=$fresh.token.refresh_token}
`);
    assert.deepEqual(result, [
      {
        writesAfterSame: 0,
        managedRefreshAfterSame: 'rotated-managed',
        writesAfterNew: 1,
        freshId: 'new-login',
        freshRefresh: 'new-login-token'
      }
    ]);
  }
);

test(
  'agy 1.4.6 credentials without id_token keep the newer managed copy and accept another account',
  {skip: process.platform !== 'win32'},
  async () => {
    const result = await runWindowsPowerShell(String.raw`
$target='fake-managed-account'
$managed=[KGeminiCredentialNative+Record]::new();$managed.Blob=[Text.Encoding]::UTF8.GetBytes('{"id_token_email":"one@example.test","token":{"expiry":"2026-10-13T00:00:00Z","refresh_token":"rotated-managed"}}')
$live=[KGeminiCredentialNative+Record]::new();$live.Blob=[Text.Encoding]::UTF8.GetBytes('{"id_token_email":"one@example.test","token":{"expiry":"2026-10-13T00:00:00Z","refresh_token":"older-live"}}')
[KGeminiCredentialNative]::Store[$target]=$managed;Save-CurrentManaged $live $target
$sameWrites=[KGeminiCredentialNative]::Writes;$same=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([KGeminiCredentialNative]::Read($target).Blob))
$other=[KGeminiCredentialNative+Record]::new();$other.Blob=[Text.Encoding]::UTF8.GetBytes('{"id_token_email":"two@example.test","token":{"expiry":"2026-10-13T00:00:00Z","refresh_token":"other-token"}}')
Save-CurrentManaged $other $target
$fresh=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([KGeminiCredentialNative]::Read($target).Blob))
Write-SafeJson @{writesAfterSame=$sameWrites;managedRefreshAfterSame=$same.token.refresh_token;writesAfterOther=[KGeminiCredentialNative]::Writes;freshRefresh=$fresh.token.refresh_token}
`);
    assert.deepEqual(result, [
      {writesAfterSame: 0, managedRefreshAfterSame: 'rotated-managed', writesAfterOther: 1, freshRefresh: 'other-token'}
    ]);
  }
);

test(
  'malformed refresh-token responses classify as quota schema errors without saving tokens',
  {skip: process.platform !== 'win32'},
  async () => {
    const result = await runWindowsPowerShell(String.raw`
function Get-InstalledGeminiClient([string]$Executable){return @{id='fake-client';secret='fake-client-secret'}}
$script:freshResponse=$null;$script:refreshCalls=0
function Invoke-GeminiQuotaHttp([string]$Uri,[string]$Token,$Form){$script:refreshCalls++;return $script:freshResponse}
$blob=[Text.Encoding]::UTF8.GetBytes('{"token":{"access_token":"old-access","refresh_token":"old-refresh","expiry":"2099-01-01T00:00:00Z"}}');$record=[PSCustomObject]@{Blob=$blob};$savedTokens=New-Object 'System.Collections.Generic.List[string]';$saveRefresh={param($data)[void]$savedTokens.Add($data.token.refresh_token)}
$cases=@(@{access_token=$null;expires_in=3600},@{access_token='rotated';expires_in=0},@{access_token='rotated';expires_in='3600'},@{access_token=42;expires_in=3600})
$errors=@();foreach($case in $cases){$script:freshResponse=$case;try{Get-ManagedGeminiQuota $record 'fake.exe' $saveRefresh $true|Out-Null;$errors+='unexpected-success'}catch{$errors+=$_.Exception.Message}}
Write-SafeJson @{errors=$errors;refreshCalls=$script:refreshCalls;savedCount=$savedTokens.Count}
`);
    assert.deepEqual(result, [
      {
        errors: Array(4).fill('QUOTA_SCHEMA:Refreshed token response missing or invalid.'),
        refreshCalls: 4,
        savedCount: 0
      }
    ]);
  }
);

test(
  'fake OAuth HTTP 400 maps invalid_grant to auth and invalid_client to client failure',
  {skip: process.platform !== 'win32'},
  async () => {
    const result = await runWindowsPowerShell(String.raw`
function Invoke-FakeOAuth($body){[KQuotaFakeHttpHandler]::Status=400;[KQuotaFakeHttpHandler]::Body=$body;$errorText='';try{Invoke-GeminiQuotaHttp 'https://oauth2.googleapis.com/token' '' @{grant_type='refresh_token'}|Out-Null}catch{$errorText=$_.Exception.Message};return $errorText}
$grant=Invoke-FakeOAuth '{"error":"invalid_grant"}';$client=Invoke-FakeOAuth '{"error":"invalid_client"}'
Write-SafeJson @{grant=$grant;client=$client}
`);
    assert.deepEqual(result, [
      {grant: 'QUOTA_AUTH:Saved login needs confirmation.', client: 'QUOTA_CLIENT:Native OAuth client rejected.'}
    ]);
  }
);

test(
  'unavailable quota endpoint is distinct from transient rate or server failures',
  {skip: process.platform !== 'win32'},
  async () => {
    const result = await runWindowsPowerShell(String.raw`
$out=@();foreach($status in @(400,403,404,410,429,500)){
 [KQuotaFakeHttpHandler]::Status=$status;[KQuotaFakeHttpHandler]::Body='{}'
 try{Invoke-GeminiQuotaHttp 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary' 'fake' $null 'antigravity/cli/1.4.0'|Out-Null}catch{$out+=@{status=$status;error=$_.Exception.Message}}
};Write-SafeJson @{errors=$out}
`);
    assert.deepEqual(
      result[0].errors.map(row => ({status: row.status, code: row.error.split(':')[0]})),
      [400, 403, 404, 410, 429, 500].map(status => ({status, code: status < 429 ? 'QUOTA_CLIENT' : 'QUOTA_TEMPORARY'}))
    );
  }
);

test(
  'invalid live credential preserves independent quota evidence and conservatively requires idle synchronization',
  {skip: process.platform !== 'win32'},
  async () => {
    const result = await runWindowsPowerShell(String.raw`
$tokens=$null;$parseErrors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile('${credentialsPath.replaceAll("'", "''")}',[ref]$tokens,[ref]$parseErrors)
$check=$ast.Find({param($n)$n -is [System.Management.Automation.Language.IfStatementAst] -and $n.Extent.Text.StartsWith('if($null -ne $live){$records.Add($live);try{')},$true)
if($null -eq $check){throw 'Live synchronization check missing.'}
$records=New-Object 'System.Collections.Generic.List[object]';$public=@{accountId='account-a'};$quota=@{windows=@('retained');updatedData=@{token=@{refresh_token='new'}}}
$live=[PSCustomObject]@{Blob=[Text.Encoding]::UTF8.GetBytes('{"token":{"refresh_token":"old"}}')}
$script:mode='invalid'
function Get-Public($record){if($script:mode -eq 'invalid'){throw 'IDENTITY:Invalid live record'};return @{accountId=$script:mode}}
$out=@();foreach($mode in @('invalid','account-a','account-b')){
 $script:mode=$mode;$requiresActivation=$false;Invoke-Expression $check.Extent.Text;$out+=@{mode=$mode;requiresActivation=$requiresActivation;quota=$quota.windows[0]}
};Write-SafeJson @{cases=$out}
`);
    assert.deepEqual(result[0].cases, [
      {mode: 'invalid', requiresActivation: true, quota: 'retained'},
      {mode: 'account-a', requiresActivation: true, quota: 'retained'},
      {mode: 'account-b', requiresActivation: false, quota: 'retained'}
    ]);
  }
);

test('OAuth error mapping branches remain explicit in the helper source', async () => {
  const source = await readFile(quotaPath, 'utf8');
  assert.match(source, /if\(\$code -eq 'invalid_grant'\)\{throw 'QUOTA_AUTH:/u);
  assert.match(source, /if\(\$code -eq 'invalid_client'\)\{throw 'QUOTA_CLIENT:/u);
  assert.match(source, /if\(\$status -eq 401\)\{throw 'QUOTA_AUTH:/u);
});
