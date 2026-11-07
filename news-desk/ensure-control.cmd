@echo off
rem Ensure the scan control service is running (called by Task Scheduler every 5 min).
wscript.exe "%~dp0start-control.vbs"
