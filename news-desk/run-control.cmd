@echo off
rem Market Desk 掃描頻率控制服務（開機常駐）
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" "%~dp0control.mjs" >> "%~dp0control.log" 2>&1
