param(
  [Parameter(Mandatory = $true)][string]$Iso,
  [ValidateSet('x64', 'arm64')][string]$Arch = 'x64',
  [int]$Index = 0,
  [string]$Report = '',
  [string]$ExpectVersion = '3.1.5'
)
$ErrorActionPreference = 'Stop'
if (-not $Index) { $Index = if ($Arch -eq 'arm64') { 3 } else { 4 } }
$suffix = if ($Arch -eq 'arm64') { '-arm64' } else { '' }
if (-not $Report) { $Report = Join-Path (Split-Path $Iso -Parent) ('VERIFY-ISO' + $suffix + '.json') }

function Get-PeMachine([string]$Path) {
  $fs = [IO.File]::OpenRead($Path)
  try {
    $br = New-Object IO.BinaryReader($fs)
    $fs.Seek(0x3C, 'Begin') | Out-Null
    $peOffset = $br.ReadInt32()
    $fs.Seek($peOffset, 'Begin') | Out-Null
    $signature = $br.ReadUInt32()
    if ($signature -ne 0x00004550) { throw ('Not a PE file: ' + $Path) }
    return $br.ReadUInt16()
  } finally { $fs.Dispose() }
}

function Get-IsoBootInfo([string]$Path) {
  $fs = [IO.File]::OpenRead($Path)
  try {
    $br = New-Object IO.BinaryReader($fs)
    $catalogLba = $null
    for ($sector = 16; $sector -lt 64; $sector++) {
      $fs.Seek([int64]$sector * 2048, 'Begin') | Out-Null
      $type = $br.ReadByte()
      $id = [Text.Encoding]::ASCII.GetString($br.ReadBytes(5))
      if ($id -ne 'CD001') { break }
      if ($type -eq 0) {
        $fs.Seek([int64]$sector * 2048 + 7, 'Begin') | Out-Null
        $spec = [Text.Encoding]::ASCII.GetString($br.ReadBytes(23)).Trim([char]0)
        if ($spec.StartsWith('EL TORITO')) {
          $fs.Seek([int64]$sector * 2048 + 0x47, 'Begin') | Out-Null
          $catalogLba = $br.ReadUInt32()
          break
        }
      }
      if ($type -eq 255) { break }
    }
    if ($null -eq $catalogLba) { return $null }
    $fs.Seek([int64]$catalogLba * 2048, 'Begin') | Out-Null
    $cat = $br.ReadBytes(2048)
    $validationPlatform = '0x{0:X2}' -f $cat[1]
    $platforms = New-Object System.Collections.Generic.List[string]
    $platforms.Add($validationPlatform)
    $currentPlatform = $validationPlatform
    for ($i = 1; $i -lt 32; $i++) {
      $off = $i * 32
      $indicator = $cat[$off]
      if ($indicator -in @(0x90, 0x91)) {
        $currentPlatform = '0x{0:X2}' -f $cat[$off + 1]
        $platforms.Add($currentPlatform)
      } elseif ($indicator -eq 0x88) {
        $platforms.Add($currentPlatform)
      }
    }
    return [pscustomobject]@{
      catalogLba = $catalogLba
      validationPlatform = $validationPlatform
      platforms = @($platforms | Select-Object -Unique)
    }
  } finally { $fs.Dispose() }
}

$checks = [ordered]@{}
$mountedByUs = $false
try {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $pr = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script elevated (Administrator).' }
  if (-not (Test-Path $Iso)) { throw ('ISO not found: ' + $Iso) }

  $checks.iso = (Resolve-Path $Iso).Path
  $checks.arch = $Arch
  $checks.index = $Index
  $checks.bytes = (Get-Item $Iso).Length
  $checks.sha256 = (Get-FileHash -LiteralPath $Iso -Algorithm SHA256).Hash.ToLowerInvariant()
  $bootInfo = Get-IsoBootInfo $Iso
  $checks.bootCatalog = $null -ne $bootInfo
  $checks.bootCatalogLba = if ($bootInfo) { $bootInfo.catalogLba } else { $null }
  $checks.validationPlatform = if ($bootInfo) { $bootInfo.validationPlatform } else { $null }
  $checks.bootPlatforms = if ($bootInfo) { @($bootInfo.platforms) } else { @() }
  $checks.biosBoot = $checks.bootCatalog -and (@($checks.bootPlatforms) -contains '0x00')
  $checks.uefiBoot = $checks.bootCatalog -and (@($checks.bootPlatforms) -contains '0xEF')
  $checks.bootOk = if ($Arch -eq 'arm64') { $checks.uefiBoot } else { $checks.biosBoot -and $checks.uefiBoot }

  $di = Get-DiskImage -ImagePath $Iso -ErrorAction SilentlyContinue
  if (-not $di -or -not $di.Attached) {
    Mount-DiskImage -ImagePath $Iso
    $mountedByUs = $true
    Start-Sleep -Seconds 2
  }
  $vol = $null
  for ($i = 0; $i -lt 20; $i++) {
    $vol = Get-DiskImage -ImagePath $Iso | Get-Volume -ErrorAction SilentlyContinue
    if ($vol -and $vol.DriveLetter) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $vol -or -not $vol.DriveLetter) { throw 'Mounted ISO has no drive letter' }
  $root = [string]$vol.DriveLetter + ':\'
  $checks.volumeLabel = [string]$vol.FileSystemLabel
  $checks.volumeOk = $checks.volumeLabel -like 'BATCAVE*'

  $checks.setupExe = Test-Path (Join-Path $root 'setup.exe')
  $checks.installWim = Test-Path (Join-Path $root 'sources\install.wim')
  $checks.installEsd = Test-Path (Join-Path $root 'sources\install.esd')
  $checks.installImage = $checks.installWim -or $checks.installEsd
  $checks.bootWim = Test-Path (Join-Path $root 'sources\boot.wim')
  $checks.biosBootFile = Test-Path (Join-Path $root 'boot\etfsboot.com')
  $checks.uefiBootFile = Test-Path (Join-Path $root 'efi\microsoft\boot\efisys.bin')
  $fallback = if ($Arch -eq 'arm64') { 'efi\boot\bootaa64.efi' } else { 'efi\boot\bootx64.efi' }
  $checks.efiFallbackFile = Test-Path (Join-Path $root $fallback)

  $payload = Join-Path $root 'sources\$OEM$\$1\BATCAVE-OS'
  $setupScripts = Join-Path $root 'sources\$OEM$\$$\Setup\Scripts'
  $checks.payload = Test-Path $payload
  $checks.serverJs = Test-Path (Join-Path $payload 'server.js')
  $checks.playerJs = Test-Path (Join-Path $payload 'public\js\apps-player.js')
  $checks.playerCss = Test-Path (Join-Path $payload 'public\css\player.css')
  $checks.nodeExe = Test-Path (Join-Path $payload 'node.exe')
  $checks.kioskVbs = Test-Path (Join-Path $payload 'start-batcave-kiosk.vbs')
  $checks.kioskCmd = Test-Path (Join-Path $payload 'start-batcave-kiosk.cmd')
  $checks.readme = Test-Path (Join-Path $payload 'BATCAVE-OS-README.txt')
  $checks.setupComplete = Test-Path (Join-Path $setupScripts 'SetupComplete.cmd')
  $checks.installScript = Test-Path (Join-Path $setupScripts 'install-batcave.ps1')
  $checks.updateSources = Test-Path (Join-Path $payload 'update\sources.json')
  $checks.noUpdateLatest = -not (Test-Path (Join-Path $payload 'update\latest.json'))
  $checks.noDataDir = -not (Test-Path (Join-Path $payload 'data'))

  $expectedMachine = if ($Arch -eq 'arm64') { 0xAA64 } else { 0x8664 }
  $expectedMachineText = '0x{0:X4}' -f $expectedMachine
  $nodePath = Join-Path $payload 'node.exe'
  $fallbackPath = Join-Path $root $fallback
  $checks.nodeMachine = if (Test-Path $nodePath) { '0x{0:X4}' -f (Get-PeMachine $nodePath) } else { $null }
  $checks.fallbackMachine = if (Test-Path $fallbackPath) { '0x{0:X4}' -f (Get-PeMachine $fallbackPath) } else { $null }
  $checks.nodeArchOk = $checks.nodeMachine -eq $expectedMachineText
  $checks.fallbackArchOk = $checks.fallbackMachine -eq $expectedMachineText

  $wimPath = Join-Path $root 'sources\install.wim'
  if (-not (Test-Path $wimPath)) { $wimPath = Join-Path $root 'sources\install.esd' }
  $wimRaw = @()
  if (Test-Path $wimPath) {
    $wimRaw = & dism.exe /English /Get-WimInfo /WimFile:$wimPath /Index:$Index 2>&1
    $checks.wimDismExit = $LASTEXITCODE
  }
  $wimText = ($wimRaw | Out-String)
  $checks.wimName = [regex]::Match($wimText, '(?m)^Name\s*:\s*(.+)$').Groups[1].Value.Trim()
  $checks.wimArch = [regex]::Match($wimText, '(?m)^Architecture\s*:\s*(.+)$').Groups[1].Value.Trim()
  $checks.wimBytes = if (Test-Path $wimPath) { (Get-Item $wimPath).Length } else { 0 }
  $checks.wimArchOk = ($Arch -eq 'arm64' -and $checks.wimArch -match '(?i)arm64') -or ($Arch -eq 'x64' -and $checks.wimArch -match '(?i)x64')
  $checks.wimIndexOk = $checks.wimDismExit -eq 0 -and $checks.wimName -ne '' -and $checks.wimArch -ne ''

  $checks.version = $null
  $checks.versionOk = $false
  $versionPath = Join-Path $payload 'version.json'
  if (Test-Path $versionPath) {
    $v = Get-Content -LiteralPath $versionPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $checks.version = [string]$v.version
    $checks.versionOk = (-not $ExpectVersion) -or ($checks.version -eq $ExpectVersion)
  }
  $checks.isoInfo = $null
  $checks.isoInfoOk = $false
  $infoPath = Join-Path $payload 'BATCAVE-ISO.json'
  if (Test-Path $infoPath) {
    $info = Get-Content -LiteralPath $infoPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $checks.isoInfo = $info
    $checks.isoInfoOk = ($info.arch -eq $Arch) -and ($info.wimIndex -eq $Index) -and (([string]$info.version) -eq [string]$checks.version)
  }

  $forbiddenNames = @('.tsowner', 'OWNER.pin', 'auth.json', 'system.db', 'progress.json', 'progress-hud.js')
  $forbidden = @()
  if (Test-Path $payload) {
    $forbidden = @(Get-ChildItem -LiteralPath $payload -Recurse -Force -File | Where-Object { $forbiddenNames -contains $_.Name })
  }
  $checks.forbiddenFiles = @($forbidden | ForEach-Object { $_.FullName.Substring($payload.Length).TrimStart('\') })
  $checks.noForbiddenFiles = $checks.forbiddenFiles.Count -eq 0

  $hudHits = @()
  $scanTextExt = @('.js', '.css', '.html', '.htm', '.md', '.json', '.txt', '.cmd', '.vbs', '.ps1', '.xml', '.svg')
  if (Test-Path $payload) {
    $scanFiles = @(Get-ChildItem -LiteralPath $payload -Recurse -Force -File | Where-Object { $_.Length -lt 2MB -and $scanTextExt -contains $_.Extension.ToLowerInvariant() })
    if ($scanFiles.Count -gt 0) {
      $hudHits = @($scanFiles | Select-String -SimpleMatch -Pattern @('bcHud', 'progress-hud', 'MISSION PROGRESS', 'progress.json'))
    }
  }
  $checks.hudReferences = @($hudHits | ForEach-Object { $_.Path.Substring($payload.Length).TrimStart('\') + ':' + $_.LineNumber })
  $checks.noTaskHud = $checks.hudReferences.Count -eq 0

  $appsText = if (Test-Path (Join-Path $payload 'lib\apps.js')) { Get-Content -LiteralPath (Join-Path $payload 'lib\apps.js') -Raw -Encoding UTF8 } else { '' }
  $storeText = if (Test-Path (Join-Path $payload 'public\js\apps-store.js')) { Get-Content -LiteralPath (Join-Path $payload 'public\js\apps-store.js') -Raw -Encoding UTF8 } else { '' }
  $serverText = if (Test-Path (Join-Path $payload 'server.js')) { Get-Content -LiteralPath (Join-Path $payload 'server.js') -Raw -Encoding UTF8 } else { '' }
  $checks.accelerators = ($appsText -match '网易UU加速器') -and ($appsText -match '雷神加速器') -and ($appsText -match '迅游加速器') -and ($storeText -match '游戏加速器') -and ($serverText -match '/api/apps/accelerators')

  $checks.setupScriptShortcut = $false
  if (Test-Path (Join-Path $setupScripts 'install-batcave.ps1')) {
    $installText = Get-Content -LiteralPath (Join-Path $setupScripts 'install-batcave.ps1') -Raw -Encoding UTF8
    $checks.setupScriptShortcut = $installText -match 'start-batcave-kiosk\.vbs' -and $installText -match 'ProgramData'
  }

  $allCore = $checks.volumeOk -and $checks.setupExe -and $checks.installImage -and $checks.bootWim -and
    $checks.biosBootFile -and $checks.uefiBootFile -and $checks.efiFallbackFile -and
    $checks.bootOk -and $checks.payload -and $checks.serverJs -and
    $checks.playerJs -and $checks.playerCss -and
    $checks.nodeExe -and $checks.kioskVbs -and $checks.kioskCmd -and $checks.readme -and $checks.setupComplete -and
    $checks.installScript -and $checks.updateSources -and $checks.noUpdateLatest -and $checks.noDataDir -and
    $checks.nodeArchOk -and $checks.fallbackArchOk -and
    $checks.wimIndexOk -and $checks.wimArchOk -and $checks.versionOk -and $checks.isoInfoOk -and
    $checks.noForbiddenFiles -and $checks.noTaskHud -and $checks.accelerators -and
    $checks.setupScriptShortcut
  $checks.allCoreOk = $allCore
}
catch {
  $checks.error = $_.Exception.Message
  $checks.allCoreOk = $false
}
finally {
  if ($mountedByUs) {
    try { Dismount-DiskImage -ImagePath $Iso | Out-Null } catch {}
  }
}

$reportDir = Split-Path $Report -Parent
if ($reportDir -and -not (Test-Path $reportDir)) { New-Item -ItemType Directory -Force -Path $reportDir | Out-Null }
$checks | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding UTF8
Write-Host ('ALL CORE OK: ' + $checks.allCoreOk)
Write-Host ('REPORT: ' + $Report)
if (-not $checks.allCoreOk) { exit 1 }
