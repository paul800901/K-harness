@echo off
powershell.exe -NoProfile -File "%~dp0scripts\Open-K-Browser.ps1"
if errorlevel 1 pause
