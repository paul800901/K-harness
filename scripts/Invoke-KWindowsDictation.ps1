param([ValidateSet('Probe','Trigger')][string]$Mode = 'Trigger')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$source = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class KForegroundWindow {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public UInt32 type; public INPUTUNION U; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public Int32 dx; public Int32 dy; public UInt32 mouseData; public UInt32 dwFlags; public UInt32 time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public UInt16 wVk; public UInt16 wScan; public UInt32 dwFlags; public UInt32 time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public UInt32 uMsg; public UInt16 wParamL; public UInt16 wParamH; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] public static extern UInt32 SendInput(UInt32 nInputs, INPUT[] inputs, Int32 size);
  public static string Text(IntPtr hwnd) { var b=new StringBuilder(512); GetWindowText(hwnd,b,b.Capacity); return b.ToString(); }
  public static string Class(IntPtr hwnd) { var b=new StringBuilder(256); GetClassName(hwnd,b,b.Capacity); return b.ToString(); }
  public static bool Hotkey() {
    const UInt16 WIN=0x5B, H=0x48; const UInt32 UP=0x0002;
    var a=new INPUT[4];
    a[0].type=a[1].type=a[2].type=a[3].type=1;
    a[0].U.ki.wVk=WIN; a[1].U.ki.wVk=H; a[2].U.ki.wVk=H; a[2].U.ki.dwFlags=UP; a[3].U.ki.wVk=WIN; a[3].U.ki.dwFlags=UP;
    return SendInput(4,a,Marshal.SizeOf(typeof(INPUT)))==4;
  }
}
'@

try {
  Add-Type -TypeDefinition $source -ErrorAction Stop
  $inputSize = [Runtime.InteropServices.Marshal]::SizeOf([type][KForegroundWindow+INPUT])
  if ($Mode -eq 'Probe') {
    [pscustomobject]@{ok=$true;mode='Probe';inputSize=$inputSize;hotkeySent=$false;note='未送出快捷鍵'} | ConvertTo-Json -Compress
    exit 0
  }
  $hwnd = [KForegroundWindow]::GetForegroundWindow()
  [uint32]$foregroundProcessId = 0
  [void][KForegroundWindow]::GetWindowThreadProcessId($hwnd,[ref]$foregroundProcessId)
  $title = [KForegroundWindow]::Text($hwnd)
  $class = [KForegroundWindow]::Class($hwnd)
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $foregroundProcessId" -ErrorAction Stop
  $name = [IO.Path]::GetFileNameWithoutExtension($proc.Name)
  $isBrowser = $name -in @('chrome','msedge')
  $isKTitle = $title -ceq 'K 執行中樞'
  if (-not ($isBrowser -and $class -eq 'Chrome_WidgetWin_1' -and $isKTitle)) {
    [pscustomobject]@{ok=$false;error='目前前景視窗無法確認是 K 執行中樞的 Chrome／Edge 應用程式視窗。請切回 K 執行中樞，或手動按 Win+H。'} | ConvertTo-Json -Compress
    exit 0
  }
  # Re-check foreground identity immediately before injecting the user-requested hotkey.
  $again = [KForegroundWindow]::GetForegroundWindow()
  [uint32]$againPid = 0
  [void][KForegroundWindow]::GetWindowThreadProcessId($again,[ref]$againPid)
  if ($again -ne $hwnd -or $againPid -ne $foregroundProcessId -or [KForegroundWindow]::Text($again) -cne 'K 執行中樞') {
    [pscustomobject]@{ok=$false;error='前景視窗已改變，未送出快捷鍵。請切回 K 執行中樞，或手動按 Win+H。'} | ConvertTo-Json -Compress
    exit 0
  }
  if (-not [KForegroundWindow]::Hotkey()) { throw '無法送出 Win+H' }
  [pscustomobject]@{ok=$true;message='已在 K 執行中樞視窗觸發 Windows 聽寫。請確認聽寫結果後再自行送出訊息。'} | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ok=$false;error='Windows 聽寫無法啟動；未確認安全的 K 前景視窗。請手動按 Win+H。'} | ConvertTo-Json -Compress
}
