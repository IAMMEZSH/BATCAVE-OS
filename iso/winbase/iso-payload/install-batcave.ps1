$ErrorActionPreference = 'Stop'
$root = 'C:\BATCAVE-OS'
$log = Join-Path $env:SystemRoot 'Setup\Scripts\batcave-setup.log'

function Write-Log([string]$message) {
  $line = (Get-Date -Format s) + ' ' + $message
  Add-Content -LiteralPath $log -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
}

try {
  Write-Log 'BEGIN'
  if (-not (Test-Path (Join-Path $root 'node.exe'))) { throw 'bundled node.exe missing' }
  if (-not (Test-Path (Join-Path $root 'server.js'))) { throw 'server.js missing' }
  if (-not (Test-Path (Join-Path $root 'start-batcave-kiosk.vbs'))) { throw 'start-batcave-kiosk.vbs missing' }

  # The in-app updater runs as the signed-in user, so the program directory must be writable by Users.
  $aclOutput = & icacls.exe $root /grant '*S-1-5-32-545:(OI)(CI)M' /T /C /Q 2>&1
  foreach ($line in @($aclOutput)) { Write-Log ('icacls: ' + $line) }
  Write-Log ('icacls exit=' + $LASTEXITCODE)

  $ws = New-Object -ComObject WScript.Shell
  $shortcuts = @(
    'C:\Users\Public\Desktop\BATCAVE.lnk',
    'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\BATCAVE.lnk',
    'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\BATCAVE.lnk'
  )
  foreach ($path in $shortcuts) {
    $dir = Split-Path $path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $sc = $ws.CreateShortcut($path)
    $sc.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $sc.Arguments = '"C:\BATCAVE-OS\start-batcave-kiosk.vbs"'
    $sc.WorkingDirectory = $root
    $sc.IconLocation = (Join-Path $env:SystemRoot 'System32\imageres.dll') + ',109'
    $sc.Description = 'BATCAVE OS'
    $sc.WindowStyle = 1
    $sc.Save()
    Write-Log ('shortcut ' + $path)
  }

  $readme = Join-Path $root 'BATCAVE-OS-README.txt'
  if (Test-Path $readme) {
    Copy-Item -LiteralPath $readme -Destination 'C:\Users\Public\Desktop\BATCAVE-READ-ME.txt' -Force
    Write-Log 'public desktop readme copied'
  }

  Write-Log 'OK'
  Copy-Item -LiteralPath $log -Destination (Join-Path $root 'setup.log') -Force
  exit 0
} catch {
  Write-Log ('FAILED: ' + $_.Exception.Message)
  try { Copy-Item -LiteralPath $log -Destination (Join-Path $root 'setup.log') -Force } catch {}
  exit 1
}
