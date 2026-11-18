@echo off
setlocal
set "LOG=%SystemRoot%\Setup\Scripts\batcave-setup.log"
echo [BATCAVE] SetupComplete start %DATE% %TIME%>>"%LOG%"
if not exist "%SystemRoot%\Setup\Scripts\install-batcave.ps1" (
  echo [BATCAVE] install-batcave.ps1 missing>>"%LOG%"
  exit /b 0
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%SystemRoot%\Setup\Scripts\install-batcave.ps1" >>"%LOG%" 2>&1
echo [BATCAVE] install exit=%ERRORLEVEL%>>"%LOG%"
exit /b 0
