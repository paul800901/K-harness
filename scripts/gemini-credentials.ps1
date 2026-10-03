param(
 [Parameter(Mandatory=$true)][ValidateSet('current','capture','activate','prepareLogin','assertIdle')][string]$Operation,
 [Parameter(Mandatory=$true)][ValidatePattern('(?i)^[a-f0-9]{32,64}$')][string]$Namespace,
 [Parameter(Mandatory=$false)][ValidatePattern('(?i)^[a-f0-9]{32}$')][string]$AccountId,
 [Parameter(Mandatory=$false)][switch]$SkipCaptureCurrent
)
$ErrorActionPreference='Stop'
$liveTarget='antigravity.gemini'

$native=@'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class KGeminiCredentialNative {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct CREDENTIAL_ATTRIBUTE { public string Keyword; public uint Flags; public uint ValueSize; public IntPtr Value; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
 public sealed class Attribute { public string Keyword; public uint Flags; public byte[] Value; }
 public sealed class Record { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public byte[] Blob; public uint Persist; public List<Attribute> Attributes; public string TargetAlias; public string UserName; }
 [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
 [DllImport("Advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
 [DllImport("Advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool CredDelete(string target, uint type, uint flags);
 [DllImport("Advapi32.dll")] static extern void CredFree(IntPtr buffer);
 static Exception Failure(){return new InvalidOperationException("CREDENTIAL:Windows Credential Manager operation failed.");}
 public static Record Read(string target){
  IntPtr ptr; if(!CredRead(target,1,0,out ptr)){int e=Marshal.GetLastWin32Error(); if(e==1168)return null; throw Failure();}
  byte[] blob=null;var attrs=new List<Attribute>();
  try { var c=(CREDENTIAL)Marshal.PtrToStructure(ptr,typeof(CREDENTIAL)); blob=new byte[(int)c.CredentialBlobSize]; if(blob.Length>0)Marshal.Copy(c.CredentialBlob,blob,0,blob.Length);
   for(int i=0;i<c.AttributeCount;i++){IntPtr ap=IntPtr.Add(c.Attributes,i*Marshal.SizeOf(typeof(CREDENTIAL_ATTRIBUTE)));var a=(CREDENTIAL_ATTRIBUTE)Marshal.PtrToStructure(ap,typeof(CREDENTIAL_ATTRIBUTE));byte[] value=new byte[(int)a.ValueSize];if(value.Length>0)Marshal.Copy(a.Value,value,0,value.Length);attrs.Add(new Attribute{Keyword=a.Keyword,Flags=a.Flags,Value=value});}
   return new Record{Flags=c.Flags,Type=c.Type,TargetName=c.TargetName,Comment=c.Comment,LastWritten=c.LastWritten,Blob=blob,Persist=c.Persist,Attributes=attrs,TargetAlias=c.TargetAlias,UserName=c.UserName};
  } catch { if(blob!=null)Array.Clear(blob,0,blob.Length);foreach(var a in attrs)if(a.Value!=null)Array.Clear(a.Value,0,a.Value.Length);throw; }
  finally {CredFree(ptr);}
 }
 public static void Write(string target, Record record, uint persistence){
  IntPtr blob=IntPtr.Zero, attrs=IntPtr.Zero;var allocated=new List<Tuple<IntPtr,int>>();int initialized=0;int size=Marshal.SizeOf(typeof(CREDENTIAL_ATTRIBUTE));
  try { if(record.Blob!=null&&record.Blob.Length>0){blob=Marshal.AllocHGlobal(record.Blob.Length);Marshal.Copy(record.Blob,0,blob,record.Blob.Length);}
   var list=record.Attributes??new List<Attribute>();if(list.Count>0)attrs=Marshal.AllocHGlobal(size*list.Count);
   for(int i=0;i<list.Count;i++){var a=list[i];IntPtr val=IntPtr.Zero;if(a.Value!=null&&a.Value.Length>0){val=Marshal.AllocHGlobal(a.Value.Length);allocated.Add(Tuple.Create(val,a.Value.Length));Marshal.Copy(a.Value,0,val,a.Value.Length);}var native=new CREDENTIAL_ATTRIBUTE{Keyword=a.Keyword,Flags=a.Flags,ValueSize=(uint)(a.Value==null?0:a.Value.Length),Value=val};Marshal.StructureToPtr(native,IntPtr.Add(attrs,i*size),false);initialized++;}
   var c=new CREDENTIAL{Flags=record.Flags,Type=record.Type,TargetName=target,Comment=record.Comment,LastWritten=record.LastWritten,CredentialBlobSize=(uint)(record.Blob==null?0:record.Blob.Length),CredentialBlob=blob,Persist=persistence,AttributeCount=(uint)list.Count,Attributes=attrs,TargetAlias=record.TargetAlias,UserName=record.UserName};
   if(!CredWrite(ref c,0))throw Failure();
  } finally {if(blob!=IntPtr.Zero){for(int i=0;i<record.Blob.Length;i++)Marshal.WriteByte(blob,i,0);Marshal.FreeHGlobal(blob);}foreach(var item in allocated){for(int i=0;i<item.Item2;i++)Marshal.WriteByte(item.Item1,i,0);Marshal.FreeHGlobal(item.Item1);}if(attrs!=IntPtr.Zero){for(int i=0;i<initialized;i++)Marshal.DestroyStructure(IntPtr.Add(attrs,i*size),typeof(CREDENTIAL_ATTRIBUTE));Marshal.FreeHGlobal(attrs);}}
 }
 public static bool EqualBytes(byte[] a,byte[] b){if(a==null||b==null||a.Length!=b.Length)return false;int diff=0;for(int i=0;i<a.Length;i++)diff|=a[i]^b[i];return diff==0;}
 public static void ClearRecord(Record r){if(r==null)return;if(r.Blob!=null)Array.Clear(r.Blob,0,r.Blob.Length);if(r.Attributes!=null)foreach(var a in r.Attributes)if(a.Value!=null)Array.Clear(a.Value,0,a.Value.Length);}
 public static bool Delete(string target){if(CredDelete(target,1,0))return true;if(Marshal.GetLastWin32Error()==1168)return false;throw Failure();}
}
'@

function Write-SafeJson($Value){[Console]::Out.WriteLine((ConvertTo-Json -InputObject $Value -Compress -Depth 5))}
function Get-Email($Record){
 if($null -eq $Record){throw 'IDENTITY:Credential identity is missing.'}
 try{$json=[Text.Encoding]::Unicode.GetString($Record.Blob).TrimEnd([char]0);$data=ConvertFrom-Json -InputObject $json -ErrorAction Stop}catch{throw 'IDENTITY:Credential identity JSON is invalid.'}
 $found=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 $visit=$null
 $visit={param($Value)
  if($null -eq $Value){return}
  if($Value -is [Collections.IDictionary]){
   foreach($key in $Value.Keys){$item=$Value[$key];if([string]$key -in @('email','email_address','emailAddress') -and $item -is [string] -and $item -match '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$'){[void]$found.Add($item.ToLowerInvariant())};& $visit $item}
  }elseif($Value -is [System.Management.Automation.PSCustomObject]){
   foreach($property in $Value.PSObject.Properties){$item=$property.Value;if($property.Name -in @('email','email_address','emailAddress') -and $item -is [string] -and $item -match '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$'){[void]$found.Add($item.ToLowerInvariant())};& $visit $item}
  }elseif($Value -is [Collections.IEnumerable] -and $Value -isnot [string]){foreach($item in $Value){& $visit $item}}
 }
 & $visit $data
 if($found.Count -eq 0){throw 'IDENTITY:Credential identity email is missing.'}
 if($found.Count -ne 1){throw 'IDENTITY:Credential identity is ambiguous.'}
 foreach($email in $found){return $email}
}
function Get-AccountId([string]$Email){$sha=[Security.Cryptography.SHA256]::Create();try{$hash=$sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Email.ToLowerInvariant()));return ([BitConverter]::ToString($hash).Replace('-','').Substring(0,32).ToLowerInvariant())}finally{$sha.Dispose()}}
function Get-ManagedTarget([string]$Id){return "K-Harness.Antigravity.$($Namespace.ToLowerInvariant()).$Id"}
function Get-Public($Record){$email=Get-Email $Record;return @{accountId=(Get-AccountId $email);email=$email}}
function Assert-Idle {$running=Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('agy','Antigravity','Antigravity.exe') };if($running){throw 'BUSY:Antigravity is running.'}}

$records=New-Object 'System.Collections.Generic.List[object]'
$exitCode=0
$nativeLoaded=$false
try {
 if($SkipCaptureCurrent -and $Operation -ne 'activate'){throw 'CREDENTIAL:SkipCaptureCurrent is only valid for activation.'}
 Add-Type -TypeDefinition $native -ErrorAction Stop
 $nativeLoaded=$true
 switch($Operation){
  'assertIdle' {Assert-Idle;Write-SafeJson @{idle=$true};break}
  'current' {$record=[KGeminiCredentialNative]::Read($liveTarget);if($null -eq $record){Write-SafeJson $null}else{$records.Add($record);Write-SafeJson (Get-Public $record)};break}
  'capture' {
   Assert-Idle;$record=[KGeminiCredentialNative]::Read($liveTarget);if($null -eq $record){throw 'CREDENTIAL:No live credential.'};$records.Add($record)
   $public=Get-Public $record;$target=Get-ManagedTarget $public.accountId
   [KGeminiCredentialNative]::Write($target,$record,2)
   $verify=[KGeminiCredentialNative]::Read($target);if($null -eq $verify){throw 'CREDENTIAL:Managed credential readback missing.'};$records.Add($verify)
   if(-not [KGeminiCredentialNative]::EqualBytes($record.Blob,$verify.Blob)){throw 'CREDENTIAL:Managed credential readback mismatch.'}
   if((Get-Public $verify).accountId -ne $public.accountId){throw 'CREDENTIAL:Managed credential identity mismatch.'}
   Write-SafeJson $public;break
  }
 'activate' {
   Assert-Idle;if(-not $AccountId){throw 'CREDENTIAL:Account id is required.'}
   $live=[KGeminiCredentialNative]::Read($liveTarget);if($null -ne $live){$records.Add($live);if(-not $SkipCaptureCurrent){$livePublic=Get-Public $live;$liveTargetName=Get-ManagedTarget $livePublic.accountId;[KGeminiCredentialNative]::Write($liveTargetName,$live,2)}}
   $record=[KGeminiCredentialNative]::Read((Get-ManagedTarget $AccountId.ToLowerInvariant()));if($null -eq $record){throw 'CREDENTIAL:Managed credential not found.'};$records.Add($record)
   $public=Get-Public $record;if($public.accountId -ne $AccountId.ToLowerInvariant()){throw 'CREDENTIAL:Managed credential identity mismatch.'}
   $metadata=if($null -ne $live){$live}else{$record};$replacement=[KGeminiCredentialNative+Record]::new();$replacement.Flags=$metadata.Flags;$replacement.Type=$metadata.Type;$replacement.Comment=$metadata.Comment;$replacement.LastWritten=$metadata.LastWritten;$replacement.Persist=$metadata.Persist;$replacement.Attributes=$metadata.Attributes;$replacement.TargetAlias=$metadata.TargetAlias;$replacement.UserName=$metadata.UserName;$replacement.Blob=[byte[]]$record.Blob
   [KGeminiCredentialNative]::Write($liveTarget,$replacement,$metadata.Persist);$records.Add($replacement)
   $verify=[KGeminiCredentialNative]::Read($liveTarget);if($null -eq $verify){throw 'CREDENTIAL:Activated live credential readback missing.'};$records.Add($verify)
   if((Get-Public $verify).accountId -ne $AccountId.ToLowerInvariant()){throw 'CREDENTIAL:Activated live credential identity mismatch.'}
   if(-not [KGeminiCredentialNative]::EqualBytes($record.Blob,$verify.Blob)){throw 'CREDENTIAL:Activated live credential readback mismatch.'}
   Write-SafeJson (Get-Public $verify);break
  }
  'prepareLogin' {
   Assert-Idle;$record=[KGeminiCredentialNative]::Read($liveTarget);$previous=$null
   if($null -ne $record){$records.Add($record);$public=Get-Public $record;$previous=$public.accountId;[KGeminiCredentialNative]::Write((Get-ManagedTarget $previous),$record,2)
    $verify=[KGeminiCredentialNative]::Read((Get-ManagedTarget $previous));if($null -eq $verify){throw 'CREDENTIAL:Managed credential readback missing.'};$records.Add($verify)
    if(-not [KGeminiCredentialNative]::EqualBytes($record.Blob,$verify.Blob)){throw 'CREDENTIAL:Managed credential readback mismatch.'}
    if((Get-Public $verify).accountId -ne $previous){throw 'CREDENTIAL:Managed credential identity mismatch.'}
    [void][KGeminiCredentialNative]::Delete($liveTarget);$stillLive=[KGeminiCredentialNative]::Read($liveTarget);if($null -ne $stillLive){$records.Add($stillLive);throw 'CREDENTIAL:Live credential removal readback failed.'}
   }
   if($null -eq $previous){Write-SafeJson $null}else{Write-SafeJson @{accountId=$previous;email=$public.email}};break
  }
 }
} catch {
 $message=$_.Exception.Message
 if($message -match '^(BUSY|IDENTITY|CREDENTIAL):'){$code=$Matches[1].ToLowerInvariant()}else{$code='credential'}
 Write-SafeJson @{errorCode=$code}
 [Console]::Error.WriteLine('Gemini credential operation failed; no credential data was emitted.')
 $exitCode=1
} finally {
 if($nativeLoaded){foreach($record in $records){[KGeminiCredentialNative]::ClearRecord($record)}}
}
if($exitCode -ne 0){exit $exitCode}
