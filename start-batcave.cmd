@echo off
setlocal
cd /d "%~dp0"
set "NODE=%~dp0node.exe"
if not exist "%NODE%" set "NODE=node"
if /i "%NODE%"=="node" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [BATCAVE] Node.js 18+ was not found.
    echo Install Node.js from https://nodejs.org or place node.exe beside server.js.
    pause
    exit /b 1
  )
)
echo [BATCAVE] starting local server...
"%NODE%" server.js %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  echo [BATCAVE] server exited with code %CODE%.
  pause
)
exit /b %CODE%
