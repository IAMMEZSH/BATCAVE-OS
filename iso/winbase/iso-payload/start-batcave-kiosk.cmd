@echo off
setlocal
cd /d "%~dp0"

if not defined LOCALAPPDATA set "LOCALAPPDATA=%USERPROFILE%\AppData\Local"
set "BATCAVE_DATA=%LOCALAPPDATA%\BATCAVE-OS"
if not exist "%BATCAVE_DATA%" mkdir "%BATCAVE_DATA%" >nul 2>&1

if exist "%BATCAVE_DATA%\server.log" (
  for %%A in ("%BATCAVE_DATA%\server.log") do if %%~zA GTR 5242880 move /y "%BATCAVE_DATA%\server.log" "%BATCAVE_DATA%\server.old.log" >nul 2>&1
)

if exist "%~dp0node.exe" (
  "%~dp0node.exe" "%~dp0server.js" --kiosk --data "%BATCAVE_DATA%" >> "%BATCAVE_DATA%\server.log" 2>&1
) else (
  node "%~dp0server.js" --kiosk --data "%BATCAVE_DATA%" >> "%BATCAVE_DATA%\server.log" 2>&1
)
