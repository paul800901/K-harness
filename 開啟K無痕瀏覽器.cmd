@echo off
rem Manual user entry only. K never invokes this file automatically.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "--user-data-dir=%~dp0.runtime\isolation-pilot\sandboxie-candidate-3b6c43ee\vault\k-chrome-profile" --incognito --enable-features=CDPScreenshotNewSurface --new-window about:blank
