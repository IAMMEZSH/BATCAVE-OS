param(
  [ValidateSet('x64', 'arm64')]
  [string]$Arch = 'x64',
  [string]$Iso = '',
  [int]$Index = 4,
  [string]$Out = '',
  [int]$SizeMB = 204800,
  [string]$Source = '',
  [string]$NodeExe = '',
  [switch]$SkipWsl,
  [switch]$KeepFailed
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Source) { $Source = $repoRoot }
if (-not $Out) {
  $outName = if ($Arch -eq 'arm64') { 'BATCAVE-Win11-Pro-arm64.vhd' } else { 'BATCAVE-Win11-Pro.vhd' }
  $Out = Join-Path $repoRoot ('iso\out\' + $outName)
}
if (-not $Iso) { Write-Host 'ERROR: 请用 -Iso 指定官方 Windows 11 ISO 的完整路径。'; exit 2 }

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
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'ERROR: run this script elevated (Administrator).'
  exit 2
}
$outDir = Split-Path $Out -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$suffix = if ($Arch -eq 'arm64') { '-arm64' } else { '' }
$log = Join-Path $outDir ('build-winbase' + $suffix + '.log')
Start-Transcript -Path $log -Force | Out-Null
$vhdMounted = $false
$weCreated = $false
$buildOk = $false
$isoWasMounted = $false
try {
  Write-Host ('BATCAVE WINBASE BUILD ' + (Get-Date -Format s))
  Write-Host ('ARCH  : ' + $Arch)
  Write-Host ('ISO   : ' + $Iso)
  Write-Host ('INDEX : ' + $Index)
  Write-Host ('OUT   : ' + $Out)
  if (-not (Test-Path $Iso)) { throw ('ISO not found: ' + $Iso) }
  if (Test-Path $Out) { throw ('Output already exists: ' + $Out) }
  if (-not (Test-Path (Join-Path $Source 'server.js'))) { throw ('BATCAVE source missing: ' + $Source) }
  if (-not $NodeExe) {
    if ($Arch -eq 'arm64') { throw 'ARM64 build requires -NodeExe pointing to an ARM64 node.exe' }
    $NodeExe = 'C:\Program Files\nodejs\node.exe'
  }
  if (-not (Test-Path $NodeExe)) { throw ('node.exe not found: ' + $NodeExe) }
  $nodeVersion = (Get-Item $NodeExe).VersionInfo.ProductVersion
  $expectedMachine = if ($Arch -eq 'arm64') { 0xAA64 } else { 0x8664 }
  $nodeMachine = Get-PeMachine $NodeExe
  if ($nodeMachine -ne $expectedMachine) { throw ('node.exe architecture mismatch: 0x{0:X4}' -f $nodeMachine) }
  Write-Host ('NODE  : ' + $NodeExe + ' (' + $nodeVersion + ', 0x' + ('{0:X4}' -f $nodeMachine) + ')')

  Write-Host '--- mount ISO ---'
  $di = Get-DiskImage -ImagePath $Iso -ErrorAction SilentlyContinue
  if (-not $di -or -not $di.Attached) {
    Mount-DiskImage -ImagePath $Iso
    $isoWasMounted = $true
    Start-Sleep -Seconds 2
  }
  $isoRoot = (Get-DiskImage -ImagePath $Iso | Get-Volume).DriveLetter + ':\'
  Write-Host ('ISO ROOT: ' + $isoRoot)
  $wim = Join-Path $isoRoot 'sources\install.wim'
  if (-not (Test-Path $wim)) { $wim = Join-Path $isoRoot 'sources\install.esd' }
  if (-not (Test-Path $wim)) { throw 'install.wim / install.esd not found in ISO' }
  $wimInfo = & dism.exe /English /Get-WimInfo /WimFile:$wim /Index:$Index
  if ($LASTEXITCODE -ne 0) { throw ('dism get-wiminfo failed: ' + $LASTEXITCODE) }
  $wimArch = (($wimInfo | Select-String '^Architecture\s*:\s*(.+)$').Matches.Groups[1].Value).Trim()
  $wimName = (($wimInfo | Select-String '^Name\s*:\s*(.+)$').Matches.Groups[1].Value).Trim()
  Write-Host ('IMAGE : ' + $wimName + ' [' + $wimArch + ']')
  if ($Arch -eq 'arm64' -and $wimArch -notmatch '(?i)arm64') { throw ('ISO image is ' + $wimArch + ', not ARM64') }
  if ($Arch -eq 'x64' -and $wimArch -notmatch '(?i)x64') { throw ('ISO image is ' + $wimArch + ', not x64') }

  Write-Host '--- create VHD ---'
  $dpFile = Join-Path $env:TEMP ('batcave-dp-' + [guid]::NewGuid().ToString('N') + '.txt')
  $dp = @"
create vdisk file="$Out" maximum=$SizeMB type=expandable
select vdisk file="$Out"
attach vdisk
convert gpt
create partition efi size=300
format quick fs=fat32 label=SYSTEM
create partition primary
format quick fs=ntfs label=WINDOWS
exit
"@
  $weCreated = $true
  $dp | Out-File -FilePath $dpFile -Encoding ASCII
  & diskpart.exe /s $dpFile
  if ($LASTEXITCODE -ne 0) { throw ('diskpart failed: ' + $LASTEXITCODE) }
  Remove-Item $dpFile -Force
  $vhdMounted = $true

  $diskNo = (Get-DiskImage -ImagePath $Out | Get-Disk).Number
  $efiPart = Get-Partition -DiskNumber $diskNo | Where-Object { $_.GptType -eq '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}' } | Select-Object -First 1
  $winPart = Get-Partition -DiskNumber $diskNo | Where-Object { $_.GptType -eq '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}' } | Select-Object -First 1
  if (-not $efiPart -or -not $winPart) { throw 'expected EFI and Windows partitions were not created' }
  $picked = New-Object System.Collections.Generic.List[string]
  function Assign-FreeLetter($partition) {
    foreach ($L in @('S','W','X','Y','Z','T','V','U','R','Q','P','O','N','M','L','K','J','I','H','G')) {
      if ($picked.Contains($L)) { continue }
      if (Get-Volume -DriveLetter $L -ErrorAction SilentlyContinue) { continue }
      try {
        Set-Partition -DiskNumber $partition.DiskNumber -PartitionNumber $partition.PartitionNumber -NewDriveLetter $L -ErrorAction Stop
        $picked.Add($L)
        return $L
      } catch { }
    }
    throw ('no free drive letter for partition ' + $partition.PartitionNumber)
  }
  $sysLetter = Assign-FreeLetter $efiPart
  $winLetter = Assign-FreeLetter $winPart
  $sysRoot = $sysLetter + ':\'
  $winRoot = $winLetter + ':\'
  Write-Host ('DRIVES: system=' + $sysLetter + ': windows=' + $winLetter + ':')
  for ($i = 0; $i -lt 20 -and (-not (Test-Path $sysRoot) -or -not (Test-Path $winRoot)); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Path $sysRoot) -or -not (Test-Path $winRoot)) { throw 'expected volumes were not mounted' }

  Write-Host '--- apply Windows image (may take 10-20 min) ---'
  $dismLog = Join-Path $outDir ('dism-apply' + $suffix + '.log')
  & dism.exe /English /Apply-Image /ImageFile:$wim /Index:$Index /ApplyDir:$winRoot /LogPath:$dismLog
  if ($LASTEXITCODE -ne 0) { throw ('dism apply failed: ' + $LASTEXITCODE) }

  Write-Host '--- write UEFI boot files ---'
  & bcdboot.exe ($winRoot + 'Windows') /s ($sysLetter + ':') /f UEFI /l zh-cn
  if ($LASTEXITCODE -ne 0) { throw ('bcdboot failed: ' + $LASTEXITCODE) }
  $bootMgrPath = Join-Path $sysRoot 'EFI\Microsoft\Boot\bootmgfw.efi'
  $bootMgrMachine = Get-PeMachine $bootMgrPath
  if ($Arch -eq 'arm64' -and $bootMgrMachine -ne 0xAA64) {
    Write-Host '--- replace UEFI boot manager with ARM64 build ---'
    $armBootDir = Join-Path $winRoot 'Windows\Boot\EFI'
    if (-not (Test-Path (Join-Path $armBootDir 'bootmgfw.efi'))) { throw 'ARM64 bootmgfw.efi not found in applied Windows image' }
    foreach ($name in @('bootmgfw.efi', 'bootmgr.efi', 'memtest.efi', 'SecureBootRecovery.efi')) {
      $src = Join-Path $armBootDir $name
      if (Test-Path $src) { Copy-Item $src (Join-Path $sysRoot 'EFI\Microsoft\Boot') -Force }
    }
    $bootMgrMachine = Get-PeMachine $bootMgrPath
  }
  if ($bootMgrMachine -ne $expectedMachine) { throw ('bootmgfw.efi architecture mismatch: 0x{0:X4}' -f $bootMgrMachine) }
  if ($Arch -eq 'arm64') {
    Remove-Item (Join-Path $sysRoot 'EFI\Boot\bootx64.efi') -Force -ErrorAction SilentlyContinue
    $fallbackSrc = Join-Path $isoRoot 'efi\boot\bootaa64.efi'
    $fallbackDst = Join-Path $sysRoot 'EFI\Boot\bootaa64.efi'
    New-Item -ItemType Directory -Force -Path (Join-Path $sysRoot 'EFI\Boot') | Out-Null
    if (Test-Path $fallbackSrc) { Copy-Item $fallbackSrc $fallbackDst -Force }
    else { Copy-Item $bootMgrPath $fallbackDst -Force }
  } else {
    $fallbackSrc = Join-Path $isoRoot 'efi\boot\bootx64.efi'
    $fallbackDst = Join-Path $sysRoot 'EFI\Boot\bootx64.efi'
    if ((Test-Path $fallbackSrc) -and -not (Test-Path $fallbackDst)) {
      New-Item -ItemType Directory -Force -Path (Join-Path $sysRoot 'EFI\Boot') | Out-Null
      Copy-Item $fallbackSrc $fallbackDst -Force
    }
  }
  Write-Host ('BOOTMGR: 0x' + ('{0:X4}' -f $bootMgrMachine))

  Write-Host '--- copy BATCAVE payload ---'
  $dest = Join-Path $winRoot 'BATCAVE-OS'
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $excludeDirs = @((Join-Path $Source 'data'), (Join-Path $Source 'iso'), (Join-Path $Source '.git'), (Join-Path $Source 'node_modules'))
  & robocopy.exe $Source $dest /E /XD $excludeDirs /XF *.log /R:1 /W:1 /NFL /NDL /NJH /NJS
  if ($LASTEXITCODE -ge 8) { throw ('robocopy failed: ' + $LASTEXITCODE) }
  Copy-Item $NodeExe (Join-Path $dest 'node.exe') -Force

  $vbs = @'
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\BATCAVE-OS"
sh.Run "cmd /c ""C:\BATCAVE-OS\node.exe"" server.js --kiosk >> ""C:\BATCAVE-OS\server.log"" 2>&1", 0, False
'@
  Set-Content -Path (Join-Path $dest 'start-batcave.vbs') -Value $vbs -Encoding ASCII

  $cmd = @'
@echo off
cd /d C:\BATCAVE-OS
start "" /min node.exe server.js --kiosk
'@
  Set-Content -Path (Join-Path $dest 'start-batcave.cmd') -Value $cmd -Encoding ASCII

  $readmeSrc = Join-Path $Source 'iso\winbase\README-FIRST.txt'
  if (Test-Path $readmeSrc) {
    Copy-Item $readmeSrc (Join-Path $winRoot 'Users\Public\Desktop\BATCAVE-READ-ME.txt') -Force
  }

  Write-Host '--- shortcuts ---'
  $ws = New-Object -ComObject WScript.Shell
  $startup = Join-Path $winRoot 'ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\BATCAVE.lnk'
  $menu = Join-Path $winRoot 'ProgramData\Microsoft\Windows\Start Menu\Programs\BATCAVE.lnk'
  $desk = Join-Path $winRoot 'Users\Public\Desktop\BATCAVE.lnk'
  foreach ($lnk in @($startup, $menu, $desk)) {
    $lnkDir = Split-Path $lnk -Parent
    if (-not (Test-Path $lnkDir)) { New-Item -ItemType Directory -Force -Path $lnkDir | Out-Null }
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = 'C:\Windows\System32\wscript.exe'
    $sc.Arguments = '"C:\BATCAVE-OS\start-batcave.vbs"'
    $sc.WorkingDirectory = 'C:\BATCAVE-OS'
    $sc.IconLocation = 'C:\Windows\System32\imageres.dll,109'
    $sc.Description = 'BATCAVE OS'
    $sc.Save()
  }

  Write-Host '--- offline registry tweaks ---'
  & reg.exe load 'HKLM\BCOFFLINE' (Join-Path $winRoot 'Windows\System32\config\SOFTWARE')
  if ($LASTEXITCODE -eq 0) {
    & reg.exe add 'HKLM\BCOFFLINE\Microsoft\Windows\CurrentVersion\OOBE' /v BypassNRO /t REG_DWORD /d 1 /f
    & reg.exe add 'HKLM\BCOFFLINE\Policies\Microsoft\Windows\OOBE' /v DisablePrivacyExperience /t REG_DWORD /d 1 /f
    & reg.exe unload 'HKLM\BCOFFLINE'
  } else {
    Write-Host 'WARN: could not load SOFTWARE hive'
  }
  & reg.exe load 'HKLM\BCSYSTEM' (Join-Path $winRoot 'Windows\System32\config\SYSTEM')
  if ($LASTEXITCODE -eq 0) {
    & reg.exe add 'HKLM\BCSYSTEM\ControlSet001\Control\BitLocker' /v PreventDeviceEncryption /t REG_DWORD /d 1 /f
    & reg.exe unload 'HKLM\BCSYSTEM'
  } else {
    Write-Host 'WARN: could not load SYSTEM hive'
  }

  $wslOk = $false
  $vmpOk = $false
  if (-not $SkipWsl) {
    Write-Host '--- enable WSL features (offline) ---'
    $wslLog = '/LogPath:' + (Join-Path $outDir ('dism-wsl' + $suffix + '.log'))
    $vmpLog = '/LogPath:' + (Join-Path $outDir ('dism-vmp' + $suffix + '.log'))
    & dism.exe /English /Image:$winRoot /Enable-Feature /FeatureName:Microsoft-Windows-Subsystem-Linux /All /NoRestart $wslLog
    $wslOk = ($LASTEXITCODE -eq 0)
    Write-Host ('WSL feature exit: ' + $LASTEXITCODE)
    & dism.exe /English /Image:$winRoot /Enable-Feature /FeatureName:VirtualMachinePlatform /All /NoRestart $vmpLog
    $vmpOk = ($LASTEXITCODE -eq 0)
    Write-Host ('VM Platform exit: ' + $LASTEXITCODE)
  }

  $info = [pscustomobject]@{
    builtAt = (Get-Date -Format s)
    arch = $Arch
    iso = $Iso
    index = $Index
    imageName = $wimName
    imageArch = $wimArch
    vhd = $Out
    source = $Source
    nodeExe = $NodeExe
    node = $nodeVersion
    nodeMachine = ('0x{0:X4}' -f $nodeMachine)
    bootManagerMachine = ('0x{0:X4}' -f $bootMgrMachine)
    wslFeatures = (-not $SkipWsl)
    wslFeatureOk = $wslOk
    vmPlatformOk = $vmpOk
  }
  $info | ConvertTo-Json | Set-Content -Path (Join-Path $outDir ('BUILD-INFO' + $suffix + '.json')) -Encoding UTF8
  $buildOk = $true
  Write-Host 'BUILD OK'
}
catch {
  Write-Host ('BUILD FAILED: ' + $_.Exception.Message)
  exit 1
}
finally {
  if ($weCreated -and (Test-Path $Out)) {
    Write-Host '--- detach VHD ---'
    $dp2 = Join-Path $env:TEMP ('batcave-dp2-' + [guid]::NewGuid().ToString('N') + '.txt')
    @"
select vdisk file="$Out"
detach vdisk
exit
"@ | Out-File -FilePath $dp2 -Encoding ASCII
    & diskpart.exe /s $dp2
    Remove-Item $dp2 -Force -ErrorAction SilentlyContinue
  }
  if ($weCreated -and -not $buildOk -and (Test-Path $Out) -and -not $KeepFailed) {
    Write-Host '--- remove failed VHD ---'
    Remove-Item $Out -Force -ErrorAction SilentlyContinue
  } elseif ($weCreated -and -not $buildOk -and $KeepFailed) {
    Write-Host ('--- keep failed VHD for diagnosis: ' + $Out + ' ---')
  }
  if ($isoWasMounted) {
    try { Dismount-DiskImage -ImagePath $Iso | Out-Null } catch {}
  }
  Stop-Transcript | Out-Null
}