import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {createGeminiCredentialVault} from '../src/gemini-credential-vault.mjs';

const execFileAsync = promisify(execFile);
const root = 'a'.repeat(64),
  email = 'person@example.test',
  accountId = createHash('sha256').update(email).digest('hex').slice(0, 32);
const metadata = {accountId, email};

test('disabled vault refuses all operations before invoking the Windows helper', async () => {
  let calls = 0;
  const vault = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows'},
    enabled: false,
    execImpl: async () => {
      calls++;
      return {stdout: 'null'};
    }
  });
  await assert.rejects(vault.current(), /尚未啟用/u);
  await assert.rejects(vault.capture(), /尚未啟用/u);
  await assert.rejects(vault.activate(accountId), /尚未啟用/u);
  await assert.rejects(vault.prepareLogin(), /尚未啟用/u);
  await assert.rejects(vault.assertIdle(), /尚未啟用/u);
  assert.equal(calls, 0);
});

test('public operations use only safe metadata and pass no secret through helper arguments', async () => {
  const calls = [];
  const vault = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows'},
    enabled: true,
    execImpl: async (file, args, options) => {
      calls.push({file, args, options});
      const op = args[args.indexOf('-Operation') + 1];
      return {stdout: JSON.stringify(op === 'assertIdle' ? {idle: true} : metadata)};
    }
  });
  assert.deepEqual(await vault.current(), metadata);
  assert.deepEqual(await vault.capture(), metadata);
  assert.deepEqual(await vault.activate(accountId), metadata);
  assert.deepEqual(await vault.activate(accountId, {preserveCurrent: false}), metadata);
  assert.deepEqual(await vault.prepareLogin(), {previousAccountId: accountId});
  for (const call of calls) {
    assert.equal(isAbsolute(call.file), true);
    assert.equal(call.args.includes(email), false);
    assert.equal(call.args.includes('refresh-token-secret'), false);
    assert.equal(call.args.includes('credential-blob-secret'), false);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.encoding, 'utf8');
  }
  assert.equal(
    calls.filter(
      call => call.args.includes('-Operation') && call.args[call.args.indexOf('-Operation') + 1] === 'assertIdle'
    ).length,
    4
  );
  const activations = calls.filter(
    call => call.args.includes('-Operation') && call.args[call.args.indexOf('-Operation') + 1] === 'activate'
  );
  assert.equal(activations[0].args.includes('-SkipCaptureCurrent'), false);
  assert.equal(activations[1].args.includes('-SkipCaptureCurrent'), true);
});

test('malformed or secret-like helper output is rejected without becoming public metadata', async () => {
  const vault = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows'},
    enabled: true,
    execImpl: async () => ({stdout: JSON.stringify({email, accountId, token: 'should-not-pass'})})
  });
  // Additional fields are not returned to callers.
  assert.deepEqual(await vault.current(), metadata);
  const bad = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows'},
    enabled: true,
    execImpl: async () => ({stdout: JSON.stringify({email, accountId: '0'.repeat(32)})})
  });
  await assert.rejects(bad.current(), /中繼資料無效/u);
});

test('safe helper error codes preserve busy and identity explanations without exposing stderr', async () => {
  const busy = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows'},
    enabled: true,
    execImpl: async () => {
      throw Object.assign(new Error('native details'), {
        stdout: '{"errorCode":"busy"}',
        stderr: 'secret-bearing stderr'
      });
    }
  });
  await assert.rejects(busy.capture(), /Antigravity 正在執行/u);
  const identity = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows'},
    enabled: true,
    execImpl: async () => {
      throw Object.assign(new Error('native details'), {
        stdout: '{"errorCode":"identity"}',
        stderr: 'secret-bearing stderr'
      });
    }
  });
  await assert.rejects(identity.current(), /憑證身分缺失或不唯一/u);
});

test('quota helper schema accepts fractions and disabled windows, rejects missing or invalid fields, and never exposes tokens', async () => {
  const windows = [
    {key: 'five_hour', disabled: false, remainingPercent: 37.5, resetsAt: 123},
    {key: 'seven_day', disabled: true, remainingPercent: null, resetsAt: null}
  ];
  const makeVault = value =>
    createGeminiCredentialVault({
      root,
      env: {SystemRoot: 'C:\\Windows', K_GEMINI_EXECUTABLE: 'C:\\fake\\agy.exe'},
      enabled: true,
      execImpl: async () => ({stdout: JSON.stringify(value)})
    });
  const value = {
    ...metadata,
    checkedAt: '2026-10-13T00:00:00.000Z',
    windows,
    refreshed: true,
    requiresActivation: false,
    access_token: 'must-not-leak',
    refresh_token: 'must-not-leak'
  };
  const result = await makeVault(value).queryQuota(accountId);
  assert.deepEqual(result, {
    ...metadata,
    auth: {status: 'authenticated', checkedAt: value.checkedAt, requiresActivation: false},
    quota: {
      status: 'ready',
      checkedAt: value.checkedAt,
      windows: [
        {key: 'five_hour', label: '5 小時', minutes: 300, disabled: false, remainingPercent: 37.5, resetsAt: 123},
        {key: 'seven_day', label: '每週', minutes: 10080, disabled: true, remainingPercent: null, resetsAt: null}
      ]
    },
    refreshed: true
  });
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|access_token|refresh_token/u);
  for (const bad of [
    null,
    {...value, windows: [windows[0]]},
    {...value, windows: [...windows, {...windows[0]}]},
    {...value, windows: [{...windows[0], remainingPercent: 101}, windows[1]]},
    {...value, windows: [{...windows[0], remainingPercent: null}, windows[1]]},
    {...value, checkedAt: 'not-a-date'}
  ])
    assert.deepEqual(await makeVault(bad).queryQuota(accountId), {
      accountId,
      auth: {status: 'unknown'},
      failureCode: 'quota_schema',
      temporaryFailure: false,
      reason: '官方額度回傳格式改變或缺失；需要檢查接頭，未派工。'
    });
});

test('independent quota helper reads serialize with activation and never require idle themselves', async () => {
  const calls = [];
  let entered, finish;
  const started = new Promise(r => (entered = r));
  const quota = {
    ...metadata,
    checkedAt: '2026-10-13T00:00:00Z',
    windows: [
      {key: 'five_hour', remainingPercent: 80},
      {key: 'seven_day', remainingPercent: 60}
    ]
  };
  const vault = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows', K_GEMINI_EXECUTABLE: 'C:\\fake\\agy.exe'},
    enabled: true,
    execImpl: async (file, args) => {
      const op = args[args.indexOf('-Operation') + 1];
      calls.push(op);
      assert.match(file, /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/iu);
      if (op === 'queryQuota') {
        entered();
        await new Promise(r => (finish = r));
        return {stdout: JSON.stringify(quota)};
      }
      return {stdout: JSON.stringify(op === 'assertIdle' ? {idle: true} : metadata)};
    }
  });
  const query = vault.queryQuota(accountId);
  await started;
  const activation = vault.activate(accountId);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ['queryQuota']);
  finish();
  await query;
  await activation;
  assert.deepEqual(calls, ['queryQuota', 'assertIdle', 'activate']);
});

test('quota helper failures return sanitized status and do not expose helper or token details', async () => {
  const vault = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows', K_GEMINI_EXECUTABLE: 'C:\\fake\\agy.exe'},
    enabled: true,
    execImpl: async () => {
      throw Object.assign(new Error('refresh-token-secret native failure'), {
        stdout: '{"errorCode":"quota_auth"}',
        stderr: 'access-token-secret'
      });
    }
  });
  const result = await vault.queryQuota(accountId);
  assert.deepEqual(result, {
    accountId,
    auth: {status: 'signed-out'},
    failureCode: 'quota_auth',
    temporaryFailure: false,
    reason: '此帳號需重新確認官方登入。'
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|token/u);
});

test('quota credential storage failures preserve waiting but schema and identity failures require attention', async () => {
  for (const code of ['credential', 'quota_client', 'identity', 'quota_schema']) {
    const vault = createGeminiCredentialVault({
      root,
      env: {K_GEMINI_EXECUTABLE: 'C:\\fake\\agy.exe'},
      enabled: true,
      execImpl: async () => {
        throw Object.assign(Error('fake secret'), {stdout: JSON.stringify({errorCode: code}), stderr: 'fake secret'});
      }
    });
    const result = await vault.queryQuota(accountId);
    assert.equal(result.temporaryFailure, code === 'credential');
    assert.equal(result.auth.status, 'unknown');
    assert.equal(result.failureCode, code);
    assert.doesNotMatch(JSON.stringify(result), /fake secret/u);
  }
});

test('helper is restricted to the exact live target and contains no credential enumeration or logout path', async () => {
  const helper = await readFile(fileURLToPath(new URL('../scripts/gemini-credentials.ps1', import.meta.url)), 'utf8');
  assert.match(helper, /\$liveTarget='gemini:antigravity'/u);
  assert.match(helper, /CredReadW/u);
  assert.match(helper, /CredWriteW/u);
  assert.match(helper, /CredDeleteW/u);
  assert.doesNotMatch(helper, /CredEnumerateW|\/logout|\.gemini[\\/]|Chrome|Get-ChildItem.*Credential/iu);
  assert.match(helper, /Get-Process/u);
  assert.doesNotMatch(helper, /Win32_Process|CommandLine|Kill\(/u);
});

test(
  'PowerShell 5.1 executes identity parsing and hashing on fake UTF-8 blobs only',
  {skip: process.platform !== 'win32'},
  async () => {
    const helper = fileURLToPath(new URL('../scripts/gemini-credentials.ps1', import.meta.url));
    const helperB64 = Buffer.from(helper, 'utf8').toString('base64');
    const blob = claims =>
      Buffer.from(
        JSON.stringify({
          token: {access_token: 'fake-only'},
          auth_method: 'oauth',
          id_token: 'fake.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.fake'
        }),
        'utf8'
      ).toString('base64');
    const valid = blob({name: '王小明', email: 'User@example.test'});
    const ambiguous = blob({email: ['one@example.test', 'two@example.test']});
    const missing = blob({name: '王小明'});
    // agy 1.4.6 keeps no id_token, only its email as id_token_email.
    const flat = email =>
      Buffer.from(
        JSON.stringify({token: {access_token: 'fake-only'}, auth_method: 'oauth', id_token_email: email}),
        'utf8'
      ).toString('base64');
    const current = flat('User@example.test');
    const currentInvalid = flat('not an email');
    const expected = createHash('sha256').update('user@example.test').digest('hex').slice(0, 32);
    const command = String.raw`
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'Expected Windows PowerShell 5.1.'}
$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${helperB64}'))
$tokens=$null;$parseErrors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'PowerShell parse failed.'}
$nativeAst=$ast.Find({param($n)$n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and $n.Left.VariablePath.UserPath -eq 'native'},$true)
if($null -eq $nativeAst -or $nativeAst.Right -isnot [System.Management.Automation.Language.CommandExpressionAst] -or $nativeAst.Right.Expression -isnot [System.Management.Automation.Language.StringConstantExpressionAst]){throw 'Native source was not a literal.'}
$functions=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in @('Get-Email','Get-AccountId','Write-SafeJson')},$true)
foreach($function in $functions){Invoke-Expression $function.Extent.Text}
Add-Type -TypeDefinition $nativeAst.Right.Expression.Value -ErrorAction Stop
$valid=[PSCustomObject]@{Blob=[Convert]::FromBase64String('${valid}')}
$ambiguous=[PSCustomObject]@{Blob=[Convert]::FromBase64String('${ambiguous}')}
$missing=[PSCustomObject]@{Blob=[Convert]::FromBase64String('${missing}')}
$current=[PSCustomObject]@{Blob=[Convert]::FromBase64String('${current}')}
$currentInvalid=[PSCustomObject]@{Blob=[Convert]::FromBase64String('${currentInvalid}')}
$email=Get-Email $valid;$accountId=Get-AccountId $email;$upper=Get-AccountId 'USER@example.test'
$ambiguousRejected=$false;try{Get-Email $ambiguous|Out-Null}catch{$ambiguousRejected=$_.Exception.Message -like 'IDENTITY:*'}
$missingRejected=$false;try{Get-Email $missing|Out-Null}catch{$missingRejected=$_.Exception.Message -like 'IDENTITY:*'}
$currentEmail=Get-Email $current
$currentInvalidRejected=$false;try{Get-Email $currentInvalid|Out-Null}catch{$currentInvalidRejected=$_.Exception.Message -like 'IDENTITY:*'}
Write-SafeJson $null
[Console]::Out.WriteLine((ConvertTo-Json -Compress @{email=$email;accountId=$accountId;upperAccountId=$upper;ambiguousRejected=$ambiguousRejected;missingRejected=$missingRejected;currentEmail=$currentEmail;currentInvalidRejected=$currentInvalidRejected}))
`;
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    const ps = await execFileAsync(
      `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 4096}
    );
    const lines = ps.stdout.trim().split(/\r?\n/u);
    assert.equal(lines[0], 'null', 'missing credentials must serialize as JSON null on PowerShell 5.1');
    const result = JSON.parse(lines[1]);
    assert.deepEqual(result, {
      email: 'user@example.test',
      accountId: expected,
      upperAccountId: expected,
      ambiguousRejected: true,
      missingRejected: true,
      currentEmail: 'user@example.test',
      currentInvalidRejected: true
    });
  }
);

test('helper failures keep operation, reason and line and record only sanitized shape in the diagnostics file', async () => {
  const {mkdtemp, mkdir} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const {scratchBase} = await import('./scratch.mjs');
  await mkdir(scratchBase, {recursive: true});
  const diagnosticsFile = join(await mkdtemp(join(scratchBase, 'gemini-diag-')), 'diagnostics', 'gemini-credential.jsonl');
  const vault = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows'},
    enabled: true,
    diagnosticsFile,
    clock: () => Date.parse('2026-10-29T07:36:40Z'),
    execImpl: async () => {
      throw Object.assign(new Error('native details secret-blob'), {
        stdout: JSON.stringify({
          errorCode: 'identity',
          errorLine: 76,
          errorType: 'RuntimeException',
          errorReason: 'identity_email_invalid',
          email: 'leak@example.test',
          live: {
            present: true,
            bytes: 812,
            writtenAt: '2026-10-29T07:35:58.0000000Z',
            fields: ['token', 'auth_method', 'secret value with spaces'],
            tokenFields: ['access_token', 'refresh_token', 'expiry'],
            idToken: 'absent',
            idTokenEmail: 'absent',
            identityReadable: false,
            access_token: 'secret-access-token'
          },
          processes: [{pid: 4242, name: 'Antigravity', startedAt: '2026-10-29T06:47:48Z', commandLine: 'secret-arg'}]
        }),
        stderr: 'secret-stderr'
      });
    }
  });
  await assert.rejects(vault.current(), error => {
    assert.equal(error.code, 'GEMINI_CREDENTIAL_IDENTITY');
    assert.match(error.message, /憑證身分缺失或不唯一.*（current：identity_email_invalid，第 76 行）/u);
    assert.deepEqual(error.helperFailure, {operation: 'current', code: 'identity', reason: 'identity_email_invalid', line: 76});
    return true;
  });
  await vault.flushDiagnostics();
  const lines = (await readFile(diagnosticsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    at: '2026-10-29T07:36:40.000Z',
    kind: 'helper_failure',
    operation: 'current',
    code: 'identity',
    reason: 'identity_email_invalid',
    line: 76,
    live: {
      present: true,
      unreadable: false,
      bytes: 812,
      writtenAt: '2026-10-29T07:35:58.0000000Z',
      json: null,
      fields: ['token', 'auth_method'],
      tokenFields: ['access_token', 'refresh_token', 'expiry'],
      idToken: 'absent',
      idTokenEmail: 'absent',
      identityReadable: false
    },
    processes: [{pid: 4242, name: 'Antigravity', startedAt: '2026-10-29T06:47:48Z'}]
  });
  assert.doesNotMatch(await readFile(diagnosticsFile, 'utf8'), /secret|leak@/u);
});

test('reads record each change of the shared login write time without returning it to callers', async () => {
  const {mkdtemp, mkdir} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const {scratchBase} = await import('./scratch.mjs');
  await mkdir(scratchBase, {recursive: true});
  const diagnosticsFile = join(await mkdtemp(join(scratchBase, 'gemini-diag-')), 'gemini-credential.jsonl');
  const times = ['2026-10-29T06:00:00Z', '2026-10-29T06:00:00Z', '2026-10-29T07:40:12Z'];
  const vault = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows'},
    enabled: true,
    diagnosticsFile,
    execImpl: async () => ({stdout: JSON.stringify({...metadata, writtenAt: times.shift()})})
  });
  for (let i = 0; i < 3; i++) assert.deepEqual(await vault.current(), metadata);
  await vault.flushDiagnostics();
  const lines = (await readFile(diagnosticsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(
    lines.map(({kind, accountId: id, writtenAt}) => ({kind, id, writtenAt})),
    [{kind: 'live_login_rewritten', id: accountId, writtenAt: '2026-10-29T07:40:12Z'}]
  );
});

test('busy helper failures carry a waitable code without a diagnostics file configured', async () => {
  const vault = createGeminiCredentialVault({
    root,
    env: {SystemRoot: 'C:\\Windows'},
    enabled: true,
    execImpl: async () => {
      throw Object.assign(new Error('x'), {stdout: '{"errorCode":"busy","errorReason":"native_process_present"}'});
    }
  });
  await assert.rejects(vault.activate(accountId), error => {
    assert.equal(error.code, 'GEMINI_CREDENTIAL_BUSY');
    assert.match(error.message, /Antigravity 正在執行（可能是官方視窗關閉後留下的背景程式）/u);
    return true;
  });
});

test(
  'PowerShell 5.1 diagnostic helpers emit only safe names and a UTC write time',
  {skip: process.platform !== 'win32'},
  async () => {
    const helper = fileURLToPath(new URL('../scripts/gemini-credentials.ps1', import.meta.url));
    const helperB64 = Buffer.from(helper, 'utf8').toString('base64');
    const command = String.raw`
$ErrorActionPreference='Stop'
$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${helperB64}'))
$tokens=$null;$parseErrors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'PowerShell parse failed.'}
$functions=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in @('Get-SafeNames','Get-WrittenAt','Write-SafeJson')},$true)
foreach($function in $functions){Invoke-Expression $function.Extent.Text}
$data=ConvertFrom-Json '{"token":{"access_token":"fake-secret"},"auth_method":"oauth","bad name":"x"}'
$ft=New-Object System.Runtime.InteropServices.ComTypes.FILETIME
$value=[DateTime]::Parse('2026-10-29T07:35:58Z').ToUniversalTime().ToFileTimeUtc()
$ft.dwLowDateTime=[BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]($value -band [long]4294967295)),0)
$ft.dwHighDateTime=[BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]($value -shr 32)),0)
$record=[PSCustomObject]@{LastWritten=$ft}
Write-SafeJson @{fields=(Get-SafeNames $data);tokenFields=(Get-SafeNames $data.token);none=(Get-SafeNames $null);writtenAt=(Get-WrittenAt $record)}
`;
    const ps = await execFileAsync(
      `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
      {windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 4096}
    );
    const result = JSON.parse(ps.stdout.trim());
    assert.deepEqual([result.fields].flat(), ['token', 'auth_method']);
    assert.deepEqual([result.tokenFields].flat(), ['access_token']);
    assert.deepEqual([result.none ?? []].flat(), []);
    assert.equal(Date.parse(result.writtenAt), Date.parse('2026-10-29T07:35:58Z'));
    assert.doesNotMatch(ps.stdout, /fake-secret|oauth/u);
  }
);
