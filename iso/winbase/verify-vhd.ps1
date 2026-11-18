param(
  [string]$Vhd = '',
  [ValidateSet('x64', 'arm64')]
  [string]$Arch = 'x64',
  [string]$Report = ''
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$suffix = if ($Arch -eq 'arm64') { '-arm64' } else { '' }
if (-not $Vhd) { $Vhd = Join-Path $repoRoot ('iso\out\BATCAVE-Win11-Pro' + $suffix + '.vhd') }
if (-not $Report) { $Report = Join-Path $repoRoot ('iso\out\VERIFY' + $suffix + '.json') }

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
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Write-Host 'Run elevated'; exit 2 }
$dp = Join-Path $env:TEMP ('bc-verify-' + [guid]::NewGuid().ToString('N') + '.txt')
$dp2 = Join-Path $env:TEMP ('bc-verify2-' + [guid]::NewGuid().ToString('N') + '.txt')
$attached = $false
try {
  @"
select vdisk file="$Vhd"
attach vdisk readonly
exit
"@ | Out-File -FilePath $dp -Encoding ASCII
  & diskpart.exe /s $dp | Out-Null
  $attached = $true
  Start-Sleep -Seconds 2

  $disk = Get-DiskImage -ImagePath $Vhd | Get-Disk
  $parts = @(Get-Partition -DiskNumber $disk.Number | Sort-Object PartitionNumber)
  $efi = $parts | Where-Object { $_.Type -eq 'System' -or $_.GptType -eq '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}' } | Select-Object -First 1
  $win = $parts | Where-Object { $_.Type -eq 'Basic' } | Sort-Object Size -Descending | Select-Object -First 1
  if (-not $efi -or -not $win) { throw 'EFI or Windows partition not found in VHD' }

  $used = @{}
  foreach ($p in $parts) { if ($p.DriveLetter) { $used[[string]$p.DriveLetter] = $true } }
  $free = @('S','X','Y','Z','V','U','T','R','Q','P') | Where-Object { -not $used[$_] -and -not (Test-Path ($_ + ':\')) }
  $efiLetter = if ($efi.DriveLetter) { [string]$efi.DriveLetter } else { $free[0] }
  $winLetter = if ($win.DriveLetter) { [string]$win.DriveLetter } else { ($free | Where-Object { $_ -ne $efiLetter })[0] }
  if (-not $efi.DriveLetter) { Add-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $efi.PartitionNumber -AccessPath ($efiLetter + ':') -ErrorAction SilentlyContinue }
  if (-not $win.DriveLetter) { Add-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $win.PartitionNumber -AccessPath ($winLetter + ':') -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2

  $checks = [ordered]@{}
  $checks.serverJs = Test-Path ($winLetter + ':\BATCAVE-OS\server.js')
  $checks.nodeExe = Test-Path ($winLetter + ':\BATCAVE-OS\node.exe')
  $checks.startVbs = Test-Path ($winLetter + ':\BATCAVE-OS\start-batcave.vbs')
  $checks.startupLnk = Test-Path ($winLetter + ':\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\BATCAVE.lnk')
  $checks.publicDesktopLnk = Test-Path ($winLetter + ':\Users\Public\Desktop\BATCAVE.lnk')
  $checks.readme = Test-Path ($winLetter + ':\Users\Public\Desktop\BATCAVE-READ-ME.txt')
  $bootMgrPath = $efiLetter + ':\EFI\Microsoft\Boot\bootmgfw.efi'
  $winloadPath = $winLetter + ':\Windows\System32\winload.efi'
  $nodePath = $winLetter + ':\BATCAVE-OS\node.exe'
  $fallbackFile = if ($Arch -eq 'arm64') { 'bootaa64.efi' } else { 'bootx64.efi' }
  $expectedMachine = if ($Arch -eq 'arm64') { 0xAA64 } else { 0x8664 }
  $expectedMachineText = '0x{0:X4}' -f $expectedMachine
  $checks.windows = Test-Path $winloadPath
  $checks.bootmgfw = Test-Path $bootMgrPath
  $checks.bcd = Test-Path ($efiLetter + ':\EFI\Microsoft\Boot\BCD')
  $checks.fallbackBoot = Test-Path ($efiLetter + ':\EFI\Boot\' + $fallbackFile)
  $checks.arch = $Arch
  $checks.bootMgrMachine = if (Test-Path $bootMgrPath) { '0x{0:X4}' -f (Get-PeMachine $bootMgrPath) } else { $null }
  $checks.winloadMachine = if (Test-Path $winloadPath) { '0x{0:X4}' -f (Get-PeMachine $winloadPath) } else { $null }
  $checks.nodeMachine = if (Test-Path $nodePath) { '0x{0:X4}' -f (Get-PeMachine $nodePath) } else { $null }
  $checks.archOk = ($checks.bootMgrMachine -eq $expectedMachineText) -and ($checks.winloadMachine -eq $expectedMachineText) -and ($checks.nodeMachine -eq $expectedMachineText)
  $checks.hlsVendor = Test-Path ($winLetter + ':\BATCAVE-OS\public\vendor\hls.min.js')
  $checks.pdfVendor = Test-Path ($winLetter + ':\BATCAVE-OS\public\vendor\pdf-lib.min.js')
  $checks.embeddedTs = Test-Path ($winLetter + ':\BATCAVE-OS\embedded\TenSaint73OS\server.js')
  $checks.embeddedGrr = Test-Path ($winLetter + ':\BATCAVE-OS\embedded\global-reading-room\server.js')
  $checks.noAuthJson = -not (Test-Path ($winLetter + ':\BATCAVE-OS\embedded\TenSaint73OS\data\auth.json'))
  $checks.noOwnerPin = -not (Test-Path ($winLetter + ':\BATCAVE-OS\embedded\TenSaint73OS\owner\OWNER.pin'))
  $checks.noBatcaveData = -not (Test-Path ($winLetter + ':\BATCAVE-OS\data\system.db'))
  $checks.wslExe = Test-Path ($winLetter + ':\Windows\System32\wsl.exe')
  $checks.vmpDll = Test-Path ($winLetter + ':\Windows\System32\vmcompute.exe')
  $checks.efiPartition = $efi.PartitionNumber
  $checks.winPartition = $win.PartitionNumber
  $checks.partitionCount = @($parts).Count
  $checks.sizeBytes = (Get-Item $Vhd).Length
  $allCore = $checks.serverJs -and $checks.nodeExe -and $checks.startVbs -and $checks.startupLnk -and $checks.bootmgfw -and $checks.bcd -and $checks.windows -and $checks.archOk
  $checks.allCoreOk = $allCore
  ($checks | ConvertTo-Json) | Set-Content -Path $Report -Encoding UTF8
  Write-Host ('CORE OK: ' + $allCore)
  Write-Host ('REPORT: ' + $Report)
}
catch {
  Write-Host ('VERIFY FAILED: ' + $_.Exception.Message)
  exit 1
}
finally {
  if ($attached) {
    @"
select vdisk file="$Vhd"
detach vdisk
exit
"@ | Out-File -FilePath $dp2 -Encoding ASCII
    & diskpart.exe /s $dp2 | Out-Null
  }
  Remove-Item $dp, $dp2 -Force -ErrorAction SilentlyContinue
}
