# Starts K's dedicated Chrome for an AI browser request and minimizes its first
# window. Chrome ignores minimized start-up settings, so the window is asked to
# minimize itself (the same command as its minimize button) once it has finished
# showing, and focus goes back to the window the owner was using. A brief flash
# is accepted by the owner (2026-10-18). The caller checks that this Chrome
# profile is not already running: a running Chrome would open the new window
# itself, in front, and this script could not minimize it.
param(
  [Parameter(Mandatory = $true)][string]$Chrome,
  [Parameter(Mandatory = $true)][string]$UserDataDir,
  [switch]$Incognito
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace KChrome -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);
'@
$arguments = @(('"--user-data-dir=' + $UserDataDir + '"'), '--enable-features=CDPScreenshotNewSurface', '--new-window', 'about:blank')
if ($Incognito) { $arguments += '--incognito' }
$browser = Start-Process -FilePath $Chrome -ArgumentList $arguments -PassThru
$deadline = [DateTime]::UtcNow.AddSeconds(15)
$previous = [IntPtr]::Zero
while ([DateTime]::UtcNow -lt $deadline) {
  $browser.Refresh()
  if ($browser.HasExited) { exit 0 }
  if ($browser.MainWindowHandle -eq [IntPtr]::Zero) {
    # The window the owner is using right before Chrome appears.
    $previous = [KChrome.Win]::GetForegroundWindow()
    Start-Sleep -Milliseconds 20
    continue
  }
  # Minimizing during Chrome's own show sequence leaves focus on Chrome and can
  # make it save a broken restore position, so let the window settle first.
  Start-Sleep -Milliseconds 150
  $browser.Refresh()
  [void][KChrome.Win]::PostMessage($browser.MainWindowHandle, 0x0112, [IntPtr]0xF020, [IntPtr]::Zero)
  # Windows hands focus to the next window in line, which may be another program.
  Start-Sleep -Milliseconds 100
  if ($previous -ne [IntPtr]::Zero -and [KChrome.Win]::IsWindow($previous) -and [KChrome.Win]::GetForegroundWindow() -ne $previous) {
    [void][KChrome.Win]::SetForegroundWindow($previous)
  }
  exit 0
}
exit 0
