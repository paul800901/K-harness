param([Parameter(Mandatory=$true)][string]$DllPath,[Parameter(Mandatory=$true)][string]$BoxName)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if($BoxName -notmatch '^[A-Za-z][A-Za-z0-9_]{0,31}$' -or -not [IO.Path]::IsPathRooted($DllPath)){throw 'Invalid Sandboxie query target'}
Add-Type -TypeDefinition @"
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public static class KSandboxQuery {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr LoadLibrary(string path);
 [DllImport("SbieDll.dll",CharSet=CharSet.Unicode,CallingConvention=CallingConvention.StdCall)] public static extern int SbieApi_QueryConf(string box,string key,uint index,StringBuilder output,uint length);
 public static string[] Read(string box){var values=new List<string>();for(uint i=0;i<1024;i++){var b=new StringBuilder(8192);int result=SbieApi_QueryConf(box,"OpenFilePath",i | 0x30000000u,b,16384);if(result==unchecked((int)0xC000008B))return values.ToArray();if(result!=0)throw new Exception("Sandboxie query failed: "+result.ToString("X8"));values.Add(b.ToString());}throw new Exception("Sandboxie query exceeded limit");}
}
"@
if([KSandboxQuery]::LoadLibrary($DllPath) -eq [IntPtr]::Zero){throw 'Could not load trusted Sandboxie DLL'}
ConvertTo-Json -InputObject @([KSandboxQuery]::Read($BoxName)) -Compress
