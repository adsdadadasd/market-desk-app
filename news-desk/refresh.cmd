@echo off
rem Market Desk 每週更新：股票清單、公司資料、公司故事（工作排程器用）
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" "%~dp0refresh.mjs" >> "%~dp0refresh.log" 2>&1
