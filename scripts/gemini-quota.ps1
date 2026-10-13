# Internal Google quota endpoint, candidate only. Secrets never leave this
# helper process. No model request, live credential write, or alternate client.
function Get-InstalledGeminiClient([string]$Executable) {
 if(-not [IO.File]::Exists($Executable)){throw 'QUOTA_CLIENT:Official CLI missing.'}
 $idHash='bf00c418024ba6bf606ccdc37120976e41bc429dd1d46ecf16a729aa532626ea'
 $secretHash='1d2f041093fd95aa8995a038c711d50a7960da09a505381c09a745d6ad0ecc60'
 $sha=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($Executable)
 $buffer=New-Object byte[] 1048576;$tail='';$id=$null;$secret=$null
 try {
  while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){
   $text=$tail+[Text.Encoding]::ASCII.GetString($buffer,0,$count)
   foreach($match in [regex]::Matches($text,'[0-9]{10,}-[a-z0-9]+\.apps\.googleusercontent\.com|GOCSPX-[A-Za-z0-9_-]{28}')){
    $hash=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($match.Value))).Replace('-','').ToLowerInvariant()
    if($hash -eq $idHash){$id=$match.Value};if($hash -eq $secretHash){$secret=$match.Value}
   }
   if($id -and $secret){return @{id=$id;secret=$secret}}
   $tail=$text.Substring([Math]::Max(0,$text.Length-256))
  }
  throw 'QUOTA_CLIENT:Unrecognized official native OAuth client.'
 }finally{$stream.Dispose();$sha.Dispose();[Array]::Clear($buffer,0,$buffer.Length)}
}
function Invoke-GeminiQuotaHttp([string]$Uri,[string]$Token,$Form) {
 Add-Type -AssemblyName System.Net.Http
 $handler=[Net.Http.HttpClientHandler]::new();$handler.AllowAutoRedirect=$false
 $http=[Net.Http.HttpClient]::new($handler);$http.Timeout=[TimeSpan]::FromSeconds(12);$http.MaxResponseContentBufferSize=1048576
 $content=$null;$response=$null
 try {
  if($Uri -notin @('https://oauth2.googleapis.com/token','https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary')){throw 'QUOTA_CLIENT:Endpoint refused.'}
  if($Form){
   $fields=New-Object 'System.Collections.Generic.Dictionary[string,string]';foreach($key in $Form.Keys){$fields.Add($key,[string]$Form[$key])}
   $content=[Net.Http.FormUrlEncodedContent]::new($fields)
  }else{
   $http.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$Token)
   $http.DefaultRequestHeaders.UserAgent.ParseAdd('antigravity')
   $content=[Net.Http.StringContent]::new('{}',[Text.Encoding]::UTF8,'application/json')
  }
  $response=$http.PostAsync($Uri,$content).GetAwaiter().GetResult()
  $status=[int]$response.StatusCode
  if($status -eq 401){throw 'QUOTA_AUTH:Saved login needs confirmation.'}
  if($status -in @(403,404,410)){throw 'QUOTA_CLIENT:Official quota endpoint or access unavailable.'}
  if(-not $Form -and $status -eq 400){throw 'QUOTA_CLIENT:Official quota request rejected.'}
  if($Form -and $status -eq 400){
   $code=(ConvertFrom-Json ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult())).error
   if($code -eq 'invalid_grant'){throw 'QUOTA_AUTH:Saved login needs confirmation.'}
   if($code -eq 'invalid_client'){throw 'QUOTA_CLIENT:Native OAuth client rejected.'}
   throw 'QUOTA_TEMPORARY:Token service unavailable.'
  }
  if($status -lt 200 -or $status -ge 300){throw 'QUOTA_TEMPORARY:Official query unsuccessful.'}
  return ConvertFrom-Json ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult())
 }catch{
  if($_.Exception.Message -match '^QUOTA_'){throw}
  throw 'QUOTA_TEMPORARY:Official query unavailable.'
 }finally{if($response){$response.Dispose()};if($content){$content.Dispose()};$http.Dispose();$handler.Dispose()}
}
function Get-GeminiQuotaBuckets($Value,[string]$Inherited='',[int]$Depth=0) {
 if($null -eq $Value -or $Depth -gt 8){return}
 if($Value -is [Array]){foreach($item in $Value){Get-GeminiQuotaBuckets $item $Inherited ($Depth+1)};return}
 if($Value -isnot [PSCustomObject]){return}
 $id=$Inherited
 foreach($key in @('id','bucketId','quotaBucketId','modelId')){if($Value.$key -is [string] -and $Value.$key -match '^gemini-(5h|weekly)$'){$id=$Value.$key}}
 if($id -match '^gemini-(5h|weekly)$'){
  $fraction=$Value.remainingFraction
  if($null -eq $fraction){$fraction=$Value.remaining.remainingFraction}
  if($Value.remaining.case -eq 'remainingFraction'){$fraction=$Value.remaining.value}
  $disabled=$Value.remaining.case -eq 'disabled' -or $Value.disabled -eq $true
  if($disabled -or ($fraction -is [ValueType] -and $fraction -isnot [bool] -and $fraction -ge 0 -and $fraction -le 1)){
   $reset=$null;$parsed=[DateTimeOffset]::MinValue
   if([DateTimeOffset]::TryParse([string]$Value.resetTime,[ref]$parsed)){$reset=$parsed.ToUnixTimeSeconds()}
   @{id=$id;remainingPercent=$(if($disabled){$null}else{[double]$fraction*100});disabled=$disabled;resetsAt=$reset}
   return
  }
 }
 foreach($property in $Value.PSObject.Properties){
  $next=$id;if($property.Name -match '^gemini-(5h|weekly)$'){$next=$property.Name}
  if($property.Value -is [Array] -or $property.Value -is [PSCustomObject]){Get-GeminiQuotaBuckets $property.Value $next ($Depth+1)}
 }
}
function Get-ManagedGeminiQuota($Record,[string]$Executable,[scriptblock]$SaveRefresh,[bool]$ForceRefresh=$false) {
 $data=ConvertFrom-Json ([Text.UTF8Encoding]::new($false,$true).GetString($Record.Blob).TrimEnd([char]0))
 if($data.token -isnot [PSCustomObject]){throw 'QUOTA_SCHEMA:Native token schema missing.'}
 $expiry=[DateTimeOffset]::MinValue;[void][DateTimeOffset]::TryParse([string]$data.token.expiry,[ref]$expiry)
 $refreshed=$false
 for($attempt=0;$attempt -lt 2;$attempt++){
 if($ForceRefresh -or -not $data.token.access_token -or $expiry -lt [DateTimeOffset]::UtcNow.AddMinutes(1)){
  if(-not $data.token.refresh_token){throw 'QUOTA_AUTH:Saved login needs confirmation.'}
  $client=Get-InstalledGeminiClient $Executable
  $fresh=Invoke-GeminiQuotaHttp 'https://oauth2.googleapis.com/token' '' @{grant_type='refresh_token';refresh_token=$data.token.refresh_token;client_id=$client.id;client_secret=$client.secret}
  if($fresh.access_token -isnot [string] -or -not $fresh.access_token -or $fresh.expires_in -isnot [ValueType] -or $fresh.expires_in -is [bool] -or $fresh.expires_in -le 0){throw 'QUOTA_SCHEMA:Refreshed token response missing or invalid.'}
  $data.token.access_token=$fresh.access_token;$data.token.expiry=[DateTimeOffset]::UtcNow.AddSeconds([double]$fresh.expires_in).ToString('o')
  if($fresh.refresh_token){$data.token.refresh_token=$fresh.refresh_token};$refreshed=$true
  if($SaveRefresh){& $SaveRefresh $data}
 }
 try{$payload=Invoke-GeminiQuotaHttp 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary' $data.token.access_token $null;break}
 catch{if($_.Exception.Message -like 'QUOTA_AUTH:*' -and -not $refreshed -and $attempt -eq 0){$ForceRefresh=$true;continue};throw}
 }
 $buckets=@(Get-GeminiQuotaBuckets $payload)
 $windows=@();foreach($period in @(@('gemini-5h','five_hour','5 小時',300),@('gemini-weekly','seven_day','每週',10080))){
  $matches=@($buckets | Where-Object { $_.id -eq $period[0] })
  if($matches.Count -ne 1){throw 'QUOTA_SCHEMA:Quota windows not uniquely provided.'}
  $windows+=@{key=$period[1];label=$period[2];minutes=$period[3];disabled=$matches[0].disabled;remainingPercent=$matches[0].remainingPercent;resetsAt=$matches[0].resetsAt}
 }
 # The caller may persist refreshed tokens in the SAME managed target, after a
 # compare/read check. No live credential is written by the quota operation.
 @{windows=$windows;refreshed=$refreshed;updatedData=$data}
}
