@echo off
rem Launcher for the "Vancouver Directory (5050)" scheduled task.
rem Keeps the working directory correct and the log inside the repo, so the task action can be
rem just this file's path — no nested quoting for schtasks to mangle.
cd /d "%~dp0"
if not exist "%~dp0logs" mkdir "%~dp0logs"
"C:\Program Files\nodejs\node.exe" server.js >> "%~dp0logs\server.log" 2>&1
