$ErrorActionPreference='Stop'
$native=@'
using System;
using System.Runtime.InteropServices;
public static class KDiscussionCredential {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Credential {public uint Flags;public uint Type;public string TargetName;public string Comment;public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;public uint Size;public IntPtr Blob;public uint Persist;public uint AttributeCount;public IntPtr Attributes;public string TargetAlias;public string UserName;}
 [DllImport("advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ReadNative(string target,uint type,uint flags,out IntPtr value);
 [DllImport("advapi32.dll",EntryPoint="CredWriteW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool WriteNative(ref Credential value,uint flags);
 [DllImport("advapi32.dll",EntryPoint="CredDeleteW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool DeleteNative(string target,uint type,uint flags);
 [DllImport("advapi32.dll")] static extern void CredFree(IntPtr value);
 public static string Read(string target){IntPtr ptr;if(!ReadNative(target,1,0,out ptr)){if(Marshal.GetLastWin32Error()==1168)return null;throw new Exception("Credential operation failed");}byte[] b=null;try{var c=(Credential)Marshal.PtrToStructure(ptr,typeof(Credential));b=new byte[c.Size];Marshal.Copy(c.Blob,b,0,b.Length);return System.Text.Encoding.UTF8.GetString(b);}finally{if(b!=null)Array.Clear(b,0,b.Length);CredFree(ptr);}}
 public static void Write(string target,string secret){byte[] b=System.Text.Encoding.UTF8.GetBytes(secret);if(b.Length>2560)throw new Exception("Credential too long");IntPtr ptr=Marshal.AllocHGlobal(b.Length);try{Marshal.Copy(b,0,ptr,b.Length);var c=new Credential{Type=1,TargetName=target,Size=(uint)b.Length,Blob=ptr,Persist=2,UserName="K discussion API"};if(!WriteNative(ref c,0))throw new Exception("Credential operation failed");}finally{for(int i=0;i<b.Length;i++)Marshal.WriteByte(ptr,i,0);Marshal.FreeHGlobal(ptr);Array.Clear(b,0,b.Length);}}
 public static void Delete(string target){if(!DeleteNative(target,1,0)&&Marshal.GetLastWin32Error()!=1168)throw new Exception("Credential operation failed");}
}
'@
try {
 $inputData=ConvertFrom-Json ([Console]::In.ReadToEnd())
 if($inputData.target -notmatch '^K-Harness\.DiscussionApi\.[a-f0-9]{64}\.[a-f0-9]{32}$'){throw 'Invalid target'}
 Add-Type -TypeDefinition $native
 switch($inputData.operation){
  'read' {$value=[KDiscussionCredential]::Read($inputData.target);[Console]::Out.WriteLine((ConvertTo-Json -Compress @{secret=$value}));break}
  'write' {if($inputData.secret -isnot [string] -or -not $inputData.secret){throw 'Missing key'};[KDiscussionCredential]::Write($inputData.target,$inputData.secret);if([KDiscussionCredential]::Read($inputData.target) -cne $inputData.secret){throw 'Readback failed'};[Console]::Out.WriteLine('{"stored":true}');break}
  'remove' {[KDiscussionCredential]::Delete($inputData.target);[Console]::Out.WriteLine('{"removed":true}');break}
  default {throw 'Invalid operation'}
 }
} catch {[Console]::Error.WriteLine('K discussion credential operation failed; secret not emitted.');exit 1}
