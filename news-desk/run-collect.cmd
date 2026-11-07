@echo off
rem Market Desk 每小時採集 + 自動摘要 + 重建檔案庫（Windows 工作排程器用）
rem 由 schtasks 呼叫，不需要開著 DSH app。
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" "%~dp0collect.mjs" --quiet >> "%~dp0collect.log" 2>&1
rem 美股收盤後的早上（HKT 04-09）若還沒有正式簡報，產生事實型自動摘要
"C:\Program Files\nodejs\node.exe" "%~dp0digest-auto.mjs" >> "%~dp0collect.log" 2>&1
"C:\Program Files\nodejs\node.exe" "%~dp0annotate-auto.mjs" --limit=40 >> "%~dp0collect.log" 2>&1
"C:\Program Files\nodejs\node.exe" "%~dp0build-site.mjs" --quiet >> "%~dp0collect.log" 2>&1
