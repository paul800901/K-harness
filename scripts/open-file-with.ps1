$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$target = [string]$request.path
if (-not [IO.Path]::IsPathRooted($target) -or -not [IO.File]::Exists($target)) {
    throw 'The selected file is no longer available.'
}
# Use the documented Windows dialog, not a command assembled from a file name.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KOpenWith {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct OPENASINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string File;
        [MarshalAs(UnmanagedType.LPWStr)] public string Class;
        public uint Flags;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    public static extern int SHOpenWithDialog(IntPtr parent, ref OPENASINFO info);
}
'@
$info = [KOpenWith+OPENASINFO]::new()
$info.File = $target
$info.Flags = 4 # OAIF_EXEC; no default-association registration.
$parent = [IntPtr]::new([long]$request.parent)
$result = [KOpenWith]::SHOpenWithDialog($parent, [ref]$info)
# Choosing Cancel is not an error (HRESULT_FROM_WIN32(ERROR_CANCELLED)).
if ($result -lt 0 -and $result -ne -2147023673) {
    [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($result)
}
