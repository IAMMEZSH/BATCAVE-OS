param(
  [ValidateSet('x64', 'arm64')][string]$Arch = 'x64',
  [string]$Iso = '',
  [int]$Index = 0,
  [string]$NodeExe = '',
  [string]$Out = '',
  [string]$WorkDir = '',
  [string]$Oscdimg = '',
  [switch]$SkipSourceHash,
  [switch]$KeepStage,
  [switch]$SkipVerify
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$version = Get-Content -LiteralPath (Join-Path $repoRoot 'version.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$suffix = if ($Arch -eq 'arm64') { '-arm64' } else { '' }
if (-not $Index) { $Index = if ($Arch -eq 'arm64') { 3 } else { 4 } }
if (-not $Out) { $Out = Join-Path $repoRoot ('iso\out\BATCAVE-OS-' + $version.version + $suffix + '.iso') }
if (-not $WorkDir) { $WorkDir = Join-Path $env:SystemDrive 'BATCAVE-ISO-BUILD' }
if (-not $NodeExe) {
  if ($Arch -eq 'arm64') { throw 'ARM64 build requires -NodeExe pointing to an ARM64 node.exe' }
  $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCmd) { $NodeExe = $nodeCmd.Source } else { $NodeExe = 'C:\Program Files\nodejs\node.exe' }
}
if (-not $Iso) { throw 'Use -Iso to specify the official Windows 11 ISO.' }

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

function Get-FreeBytes([string]$Path) {
  $pathRoot = [IO.Path]::GetPathRoot($Path)
  if (-not $pathRoot) { throw ('Path has no drive root: ' + $Path) }
  $drive = $pathRoot.Substring(0, 1)
  $psDrive = Get-PSDrive -Name $drive -ErrorAction Stop
  return [int64]$psDrive.Free
}

function Copy-AsciiCrlf([string]$Source, [string]$Dest) {
  $text = [IO.File]::ReadAllText($Source, [Text.Encoding]::UTF8)
  $text = $text.Replace("`r`n", "`n").Replace("`n", "`r`n")
  [IO.File]::WriteAllText($Dest, $text, [Text.Encoding]::ASCII)
}

function Copy-Utf8Crlf([string]$Source, [string]$Dest) {
  $text = [IO.File]::ReadAllText($Source, [Text.Encoding]::UTF8)
  $text = $text.Replace("`r`n", "`n").Replace("`n", "`r`n")
  [IO.File]::WriteAllText($Dest, $text, (New-Object Text.UTF8Encoding($true)))
}

$outDir = Split-Path $Out -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$log = Join-Path $outDir ('build-iso' + $suffix + '.log')
Start-Transcript -Path $log -Force | Out-Null
$sourceMountedByUs = $false
$outCreated = $false
$stage = Join-Path $WorkDir ('stage' + $suffix)
$buildOk = $false
try {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $pr = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this script elevated (Administrator).' }

  Write-Host ('BATCAVE ISO BUILD ' + (Get-Date -Format s))
  Write-Host ('ARCH  : ' + $Arch)
  Write-Host ('ISO   : ' + $Iso)
  Write-Host ('INDEX : ' + $Index)
  Write-Host ('OUT   : ' + $Out)
  if (-not (Test-Path $Iso)) { throw ('ISO not found: ' + $Iso) }
  if (Test-Path $Out) { throw ('Output already exists: ' + $Out) }
  if (-not (Test-Path (Join-Path $repoRoot 'server.js'))) { throw ('BATCAVE source missing: ' + $repoRoot) }
  if (-not (Test-Path $NodeExe)) { throw ('node.exe not found: ' + $NodeExe) }

  $expectedMachine = if ($Arch -eq 'arm64') { 0xAA64 } else { 0x8664 }
  $expectedMachineText = '0x{0:X4}' -f $expectedMachine
  $nodeMachine = Get-PeMachine $NodeExe
  if ($nodeMachine -ne $expectedMachine) { throw ('node.exe architecture mismatch: ' + ('0x{0:X4}' -f $nodeMachine)) }
  $nodeVersion = (Get-Item $NodeExe).VersionInfo.ProductVersion
  Write-Host ('NODE  : ' + $NodeExe + ' (' + $nodeVersion + ', ' + $expectedMachineText + ')')

  if (-not $Oscdimg) {
    $oscdimgCmd = Get-Command oscdimg.exe -ErrorAction SilentlyContinue
    if ($oscdimgCmd) { $Oscdimg = $oscdimgCmd.Source }
  }
  if (-not $Oscdimg) {
    $oscdimgCandidates = @(
      (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Microsoft.OSCDIMG_Microsoft.Winget.Source_8wekyb3d8bbwe\oscdimg.exe'),
      'C:\Program Files (x86)\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe'
    )
    foreach ($candidate in $oscdimgCandidates) {
      if (Test-Path $candidate) { $Oscdimg = $candidate; break }
    }
  }
  if (-not $Oscdimg -and (Test-Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'))) {
    $foundOscdimg = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter oscdimg.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($foundOscdimg) { $Oscdimg = $foundOscdimg.FullName }
  }
  if (-not $Oscdimg -or -not (Test-Path $Oscdimg)) { throw 'oscdimg.exe not found. Install Microsoft.OSCDIMG or pass -Oscdimg.' }
  Write-Host ('OSCDIMG: ' + $Oscdimg)

  Write-Host '--- mount source ISO ---'
  $sourceImage = Get-DiskImage -ImagePath $Iso -ErrorAction SilentlyContinue
  if (-not $sourceImage -or -not $sourceImage.Attached) {
    Mount-DiskImage -ImagePath $Iso
    $sourceMountedByUs = $true
    Start-Sleep -Seconds 2
  }
  $sourceVol = $null
  for ($i = 0; $i -lt 20; $i++) {
    $sourceVol = Get-DiskImage -ImagePath $Iso | Get-Volume -ErrorAction SilentlyContinue
    if ($sourceVol -and $sourceVol.DriveLetter) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $sourceVol -or -not $sourceVol.DriveLetter) { throw 'Source ISO has no drive letter' }
  $isoRoot = [string]$sourceVol.DriveLetter + ':\'
  $sourceLabel = [string]$sourceVol.FileSystemLabel
  Write-Host ('SOURCE: ' + $isoRoot + ' [' + $sourceLabel + ']')

  $sourceWim = Join-Path $isoRoot 'sources\install.wim'
  if (-not (Test-Path $sourceWim)) { $sourceWim = Join-Path $isoRoot 'sources\install.esd' }
  if (-not (Test-Path $sourceWim)) { throw 'install.wim / install.esd not found in source ISO' }
  $installImageName = Split-Path $sourceWim -Leaf
  $sourceBootWim = Join-Path $isoRoot 'sources\boot.wim'
  if (-not (Test-Path $sourceBootWim)) { throw 'boot.wim not found in source ISO' }
  if (-not (Test-Path (Join-Path $isoRoot 'setup.exe'))) { throw 'setup.exe not found in source ISO' }
  $sourceEtfs = Join-Path $isoRoot 'boot\etfsboot.com'
  $sourceEfisys = Join-Path $isoRoot 'efi\microsoft\boot\efisys.bin'
  if (-not (Test-Path $sourceEtfs)) { throw 'boot\etfsboot.com not found' }
  if (-not (Test-Path $sourceEfisys)) { throw 'efi\microsoft\boot\efisys.bin not found' }

  Write-Host '--- read Windows image information ---'
  $wimRaw = & dism.exe /English /Get-WimInfo /WimFile:$sourceWim /Index:$Index 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('dism get-wiminfo failed: ' + $LASTEXITCODE) }
  $wimText = ($wimRaw | Out-String)
  $wimName = [regex]::Match($wimText, '(?m)^Name\s*:\s*(.+)$').Groups[1].Value.Trim()
  $wimArch = [regex]::Match($wimText, '(?m)^Architecture\s*:\s*(.+)$').Groups[1].Value.Trim()
  if (-not $wimName -or -not $wimArch) { throw 'Could not parse WIM name / architecture' }
  if ($Arch -eq 'arm64' -and $wimArch -notmatch '(?i)arm64') { throw ('Source image is ' + $wimArch + ', not ARM64') }
  if ($Arch -eq 'x64' -and $wimArch -notmatch '(?i)x64') { throw ('Source image is ' + $wimArch + ', not x64') }
  Write-Host ('IMAGE : ' + $wimName + ' [' + $wimArch + ']')

  $sourceIsoBytes = (Get-Item $Iso).Length
  $sourceIsoSha256 = $null
  if (-not $SkipSourceHash) {
    Write-Host '--- hash source ISO ---'
    $sourceIsoSha256 = (Get-FileHash -LiteralPath $Iso -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host ('SOURCE SHA256: ' + $sourceIsoSha256)
  }
  $sourceFiles = @(Get-ChildItem -LiteralPath $isoRoot -Recurse -Force -File)
  $sourceFileCount = $sourceFiles.Count
  $sourceBytes = ($sourceFiles | Measure-Object -Property Length -Sum).Sum
  Write-Host ('SOURCE TREE: ' + $sourceFileCount + ' files, ' + $sourceBytes + ' bytes')

  $needStage = [int64]($sourceIsoBytes * 1.1) + 1GB
  $needOut = [int64]($sourceIsoBytes * 1.1) + 1GB
  if ([IO.Path]::GetPathRoot($WorkDir).Substring(0, 1) -eq [IO.Path]::GetPathRoot($Out).Substring(0, 1)) {
    $free = Get-FreeBytes $WorkDir
    if ($free -lt ($needStage + $needOut)) { throw ('Not enough free space on build drive: need ' + ($needStage + $needOut) + ', free ' + $free) }
  } else {
    if ((Get-FreeBytes $WorkDir) -lt $needStage) { throw 'Not enough free space for staging' }
    if ((Get-FreeBytes $Out) -lt $needOut) { throw 'Not enough free space for output ISO' }
  }

  Write-Host '--- stage official installation tree (read-only source) ---'
  if (-not (Test-Path $WorkDir)) { New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null }
  if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  & robocopy.exe $isoRoot $stage /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /XJ
  if ($LASTEXITCODE -ge 8) { throw ('robocopy failed: ' + $LASTEXITCODE) }
  $stageFiles = @(Get-ChildItem -LiteralPath $stage -Recurse -Force -File)
  $stageFileCount = $stageFiles.Count
  $stageBytes = ($stageFiles | Measure-Object -Property Length -Sum).Sum
  Write-Host ('STAGE TREE: ' + $stageFileCount + ' files, ' + $stageBytes + ' bytes')
  if ($stageFileCount -ne $sourceFileCount) { throw ('Staged file count mismatch: ' + $stageFileCount + ' != ' + $sourceFileCount) }
  if ([int64]$stageBytes -ne [int64]$sourceBytes) { throw ('Staged byte count mismatch: ' + $stageBytes + ' != ' + $sourceBytes) }
  $stagedWim = Join-Path $stage ('sources\' + $installImageName)
  if ((Get-Item $stagedWim).Length -ne (Get-Item $sourceWim).Length) { throw 'Staged install image size mismatch' }

  Write-Host '--- add BATCAVE $OEM$ payload ---'
  $payload = Join-Path $stage 'sources\$OEM$\$1\BATCAVE-OS'
  New-Item -ItemType Directory -Force -Path $payload | Out-Null
  $appEntries = @('server.js', 'lib', 'public', 'embedded', 'docs', 'README.md', 'CHANGELOG.md', 'LICENSE', 'version.json', 'package.json', 'start-batcave.cmd', 'start-batcave.vbs')
  foreach ($rel in $appEntries) {
    $src = Join-Path $repoRoot $rel
    if (-not (Test-Path $src)) { throw ('BATCAVE entry missing: ' + $rel) }
    Copy-Item -LiteralPath $src -Destination (Join-Path $payload $rel) -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $payload 'bin') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $payload 'update') | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot 'update\sources.json') -Destination (Join-Path $payload 'update\sources.json') -Force
  Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $payload 'node.exe') -Force

  $templates = Join-Path $PSScriptRoot 'iso-payload'
  Copy-AsciiCrlf (Join-Path $templates 'start-batcave-kiosk.cmd') (Join-Path $payload 'start-batcave-kiosk.cmd')
  Copy-AsciiCrlf (Join-Path $templates 'start-batcave-kiosk.vbs') (Join-Path $payload 'start-batcave-kiosk.vbs')
  Copy-Utf8Crlf (Join-Path $PSScriptRoot 'README-FIRST.txt') (Join-Path $payload 'BATCAVE-OS-README.txt')

  $setupScripts = Join-Path $stage 'sources\$OEM$\$$\Setup\Scripts'
  New-Item -ItemType Directory -Force -Path $setupScripts | Out-Null
  Copy-AsciiCrlf (Join-Path $templates 'SetupComplete.cmd') (Join-Path $setupScripts 'SetupComplete.cmd')
  Copy-AsciiCrlf (Join-Path $templates 'install-batcave.ps1') (Join-Path $setupScripts 'install-batcave.ps1')

  $isoInfo = [pscustomobject]@{
    product = 'BATCAVE OS'
    version = [string]$version.version
    codename = [string]$version.codename
    arch = $Arch
    wimIndex = $Index
    wimName = $wimName
    wimArch = $wimArch
    sourceLabel = $sourceLabel
    nodeVersion = $nodeVersion
    nodeMachine = $expectedMachineText
    builtAt = (Get-Date -Format s)
    installRoot = 'C:\BATCAVE-OS'
    autoStart = 'ProgramData StartUp shortcut -> start-batcave-kiosk.vbs'
  }
  $isoInfo | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $payload 'BATCAVE-ISO.json') -Encoding UTF8

  Write-Host '--- verify payload safety ---'
  $forbiddenNames = @('.tsowner', 'OWNER.pin', 'auth.json', 'system.db', 'progress.json', 'progress-hud.js')
  $forbidden = @(Get-ChildItem -LiteralPath $payload -Recurse -Force -File | Where-Object { $forbiddenNames -contains $_.Name })
  if ($forbidden.Count -gt 0) { throw ('Forbidden files in payload: ' + (($forbidden | ForEach-Object { $_.FullName }) -join '; ')) }
  if (Test-Path (Join-Path $payload 'data')) { throw 'data directory must not be packaged' }
  if (Test-Path (Join-Path $payload 'update\latest.json')) { throw 'update/latest.json must not be packaged' }
  $scanTextExt = @('.js', '.css', '.html', '.htm', '.md', '.json', '.txt', '.cmd', '.vbs', '.ps1', '.xml', '.svg')
  $scanFiles = @(Get-ChildItem -LiteralPath $payload -Recurse -Force -File | Where-Object { $_.Length -lt 2MB -and $scanTextExt -contains $_.Extension.ToLowerInvariant() })
  $hudHits = @()
  if ($scanFiles.Count -gt 0) {
    $hudHits = @($scanFiles | Select-String -SimpleMatch -Pattern @('bcHud', 'progress-hud', 'MISSION PROGRESS', 'progress.json'))
  }
  if ($hudHits.Count -gt 0) { throw ('Task HUD references found: ' + (($hudHits | ForEach-Object { $_.Path + ':' + $_.LineNumber }) -join '; ')) }
  $appsText = Get-Content -LiteralPath (Join-Path $payload 'lib\apps.js') -Raw -Encoding UTF8
  $storeText = Get-Content -LiteralPath (Join-Path $payload 'public\js\apps-store.js') -Raw -Encoding UTF8
  $serverText = Get-Content -LiteralPath (Join-Path $payload 'server.js') -Raw -Encoding UTF8
  $accelFlags = [ordered]@{
    uu = [bool]($appsText -match '网易UU加速器')
    leigod = [bool]($appsText -match '雷神加速器')
    xunyou = [bool]($appsText -match '迅游加速器')
    store = [bool]($storeText -match '游戏加速器')
    api = [bool]($serverText -match '/api/apps/accelerators')
  }
  if (@($accelFlags.Values) -contains $false) {
    throw ('Accelerator payload check failed: ' + (($accelFlags.GetEnumerator() | ForEach-Object { $_.Key + '=' + $_.Value }) -join ', '))
  }
  $payloadFiles = @(Get-ChildItem -LiteralPath $payload -Recurse -Force -File)
  $payloadBytes = ($payloadFiles | Measure-Object -Property Length -Sum).Sum
  Write-Host ('PAYLOAD: ' + $payloadFiles.Count + ' files, ' + $payloadBytes + ' bytes')

  Write-Host '--- create bootable ISO ---'
  $label = 'BATCAVE_OS_' + ($version.version -replace '\.', '') + '_' + $Arch.ToUpperInvariant()
  $etfs = Join-Path $stage 'boot\etfsboot.com'
  $efisys = Join-Path $stage 'efi\microsoft\boot\efisys.bin'
  $bootData = if ($Arch -eq 'arm64') {
    '-bootdata:1#pEF,e,b' + $efisys
  } else {
    '-bootdata:2#p0,e,b' + $etfs + '#pEF,e,b' + $efisys
  }
  $oscdimgArgs = @(
    '-m', '-o', '-u2', '-udfver102', '-h',
    ('-l' + $label),
    $bootData,
    $stage,
    $Out
  )
  & $Oscdimg @oscdimgArgs
  if ($LASTEXITCODE -ne 0) { throw ('oscdimg failed: ' + $LASTEXITCODE) }
  if (-not (Test-Path $Out)) { throw 'oscdimg did not create the output ISO' }
  $outCreated = $true
  $outputBytes = (Get-Item $Out).Length
  $outputSha256 = (Get-FileHash -LiteralPath $Out -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host ('OUTPUT: ' + $outputBytes + ' bytes')
  Write-Host ('OUTPUT SHA256: ' + $outputSha256)

  $verifyReport = Join-Path $outDir ('VERIFY-ISO' + $suffix + '.json')
  $allCoreOk = $false
  if (-not $SkipVerify) {
    Write-Host '--- verify mounted output ISO ---'
    $verifyScript = Join-Path $PSScriptRoot 'verify-iso.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $verifyScript -Iso $Out -Arch $Arch -Index $Index -Report $verifyReport -ExpectVersion $version.version
    if ($LASTEXITCODE -ne 0) { throw ('ISO verification failed: ' + $LASTEXITCODE) }
    $verify = Get-Content -LiteralPath $verifyReport -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $verify.allCoreOk) { throw 'ISO verification returned allCoreOk=false' }
    $allCoreOk = $true
  }

  $buildInfo = [pscustomobject]@{
    builtAt = (Get-Date -Format s)
    product = 'BATCAVE OS'
    version = [string]$version.version
    codename = [string]$version.codename
    arch = $Arch
    volumeLabel = $label
    output = $Out
    outputBytes = $outputBytes
    outputSha256 = $outputSha256
    sourceIso = $Iso
    sourceLabel = $sourceLabel
    sourceIsoBytes = $sourceIsoBytes
    sourceIsoSha256 = $sourceIsoSha256
    index = $Index
    imageName = $wimName
    imageArch = $wimArch
    installImage = $installImageName
    nodeExe = $NodeExe
    nodeVersion = $nodeVersion
    nodeMachine = $expectedMachineText
    sourceFileCount = $sourceFileCount
    sourceBytes = $sourceBytes
    payloadFileCount = $payloadFiles.Count
    payloadBytes = $payloadBytes
    verifyReport = $verifyReport
    allCoreOk = $allCoreOk
  }
  $buildInfoPath = Join-Path $outDir ('ISO-BUILD' + $suffix + '.json')
  $buildInfo | ConvertTo-Json | Set-Content -LiteralPath $buildInfoPath -Encoding UTF8

  $sumsPath = Join-Path $outDir 'ISO-SHA256SUMS.txt'
  $fileName = Split-Path $Out -Leaf
  $sumLines = @()
  if (Test-Path $sumsPath) { $sumLines = @(Get-Content -LiteralPath $sumsPath | Where-Object { $_ -notmatch [regex]::Escape($fileName) }) }
  $sumLines += ($outputSha256 + '  ' + $fileName)
  $sumLines | Set-Content -LiteralPath $sumsPath -Encoding ASCII
  $buildOk = $true
  Write-Host 'ISO BUILD OK'
}
catch {
  Write-Host ('ISO BUILD FAILED: ' + $_.Exception.Message)
  exit 1
}
finally {
  if ($outCreated -and -not $buildOk -and (Test-Path $Out)) {
    Write-Host ('--- remove failed output: ' + $Out + ' ---')
    Remove-Item -LiteralPath $Out -Force -ErrorAction SilentlyContinue
  }
  if ($buildOk -and -not $KeepStage -and (Test-Path $stage)) {
    Write-Host ('--- remove staging: ' + $stage + ' ---')
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  } elseif (-not $buildOk -and (Test-Path $stage)) {
    Write-Host ('--- keep staging for diagnosis: ' + $stage + ' ---')
  }
  if ($sourceMountedByUs) {
    try { Dismount-DiskImage -ImagePath $Iso | Out-Null } catch {}
  }
  Stop-Transcript | Out-Null
}
