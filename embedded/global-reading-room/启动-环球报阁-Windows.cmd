@echo off
chcp 65001 >nul
title 环球报阁 - 启动器
cd /d "%~dp0"

set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo.
    echo   未找到 Node.js 运行时。
    echo   请安装 Node.js 18+，或在当前目录放置 runtime\node.exe 后重试。
    echo.
    pause
    exit /b 1
  )
  set "NODE=node"
)

set "ADDR=http://127.0.0.1:7317"
if defined GRR_PORT set "ADDR=http://127.0.0.1:%GRR_PORT%"
echo ===============================================
echo   环球报阁 - 独立启动
echo   目录: %~dp0
echo   地址: %ADDR%
echo   关闭本窗口即停止服务。
echo ===============================================
echo.
"%NODE%" server.js %*
echo.
echo 服务已停止。
pause
