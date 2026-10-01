@echo off
powershell.exe -NoProfile -File "%~dp0scripts\Open-K-Browser.ps1" -Incognito
if errorlevel 1 pause
