param(
  [string]$Vhd = '',
  [ValidateSet('x64', 'arm64')]
  [string]$Arch = 'x64',
  [int]$DiskNumber = -1,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
if (-not $Vhd) {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $name = if ($Arch -eq 'arm64') { 'BATCAVE-Win11-Pro-arm64.vhd' } else { 'BATCAVE-Win11-Pro.vhd' }
  $Vhd = Join-Path $repoRoot ('iso\out\' + $name)
}

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
  Write-Host 'ERROR: 请以管理员身份运行本脚本。'
  exit 2
}
if (-not (Test-Path $Vhd)) { Write-Host ('ERROR: 找不到 VHD: ' + $Vhd); exit 2 }

$outDir = Split-Path $Vhd -Parent
$log = Join-Path $outDir 'deploy-usb.log'
Start-Transcript -Path $log -Force | Out-Null
$vhdAttached = $false
$vhdLetter = $null
$usbEfi = $null
$usbWin = $null
$wim = Join-Path $env:TEMP ('batcave-usb-' + [guid]::NewGuid().ToString('N') + '.wim')
$dp = Join-Path $env:TEMP ('bc-usb-dp-' + [guid]::NewGuid().ToString('N') + '.txt')

function Get-FreeLetter([string[]]$Avoid) {
  foreach ($l in @('S','W','X','Y','Z','V','U','T','R','Q','P','O','N')) {
    if ($Avoid -contains $l) { continue }
    if (-not (Test-Path ($l + ':\'))) { return $l }
  }
  throw '没有可用的盘符，请先释放 S/W 等盘符后重试。'
}

try {
  Write-Host '=== BATCAVE USB 直写部署 ==='
  Write-Host ('VHD: ' + $Vhd)
  $disks = @(Get-Disk | Where-Object { $_.BusType -eq 'USB' -and -not $_.IsBoot -and -not $_.IsSystem } |
    Sort-Object Number)
  if (-not $disks.Count) { throw '未检测到可用的 USB 磁盘。请插入 U 盘后重试；内置磁盘一律不会被列出。' }
  Write-Host ''
  Write-Host '可用 USB 磁盘（整盘将被清空）:'
  $disks | ForEach-Object {
    Write-Host ('  [' + $_.Number + '] ' + $_.FriendlyName + '  ' + [math]::Round($_.Size / 1GB, 1) + ' GB  ' + $_.BusType)
  }
  if ($DiskNumber -lt 0) {
    $rawDisk = Read-Host '输入要写入的 USB 磁盘编号'
    if ($rawDisk -notmatch '^\d+$') { throw '磁盘编号无效。' }
    $DiskNumber = [int]$rawDisk
  }
  $usb = Get-Disk -Number $DiskNumber -ErrorAction Stop
  if ($usb.BusType -ne 'USB') { throw '拒绝执行：目标不是 USB 磁盘。' }
  if ($usb.IsBoot -or $usb.IsSystem) { throw '拒绝执行：目标是系统或启动磁盘。' }
  if ($usb.Size -lt 64GB) { throw ('U 盘容量不足：' + [math]::Round($usb.Size / 1GB, 1) + ' GB，至少需要 64 GB。') }
  if (-not $Force) {
    Write-Host ''
    Write-Host ('即将彻底清空磁盘 [' + $usb.Number + '] ' + $usb.FriendlyName + '，全部数据不可恢复。')
    $ans = Read-Host '确认请输入 ERASE'
    if ($ans -ne 'ERASE') { throw '已取消。' }
  }

  Write-Host '--- 检查临时空间 ---'
  $free = (Get-PSDrive -Name C).Free
  if ($free -lt 20GB) { throw ('C 盘临时空间不足：' + [math]::Round($free / 1GB, 1) + ' GB，至少需要 20 GB 用于中转镜像。') }

  Write-Host '--- 挂载源 VHD ---'
  @"
select vdisk file="$Vhd"
attach vdisk readonly
exit
"@ | Out-File -FilePath $dp -Encoding ASCII
  & diskpart.exe /s $dp | Out-Null
  $vhdAttached = $true
  Start-Sleep -Seconds 2
  $vhdDisk = Get-DiskImage -ImagePath $Vhd | Get-Disk
  $vhdParts = @(Get-Partition -DiskNumber $vhdDisk.Number)
  $src = $vhdParts | Where-Object { $_.Type -eq 'Basic' } | Sort-Object Size -Descending | Select-Object -First 1
  if (-not $src) { throw '源 VHD 中未找到 Windows 分区。' }
  $vhdLetter = if ($src.DriveLetter) { [string]$src.DriveLetter } else { Get-FreeLetter @() }
  if (-not $src.DriveLetter) {
    Add-PartitionAccessPath -DiskNumber $vhdDisk.Number -PartitionNumber $src.PartitionNumber -AccessPath ($vhdLetter + ':') -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  if (-not (Test-Path ($vhdLetter + ':\Windows\System32\winload.efi'))) { throw '源 VHD 的 Windows 分区不可读。' }
  $srcDir = $vhdLetter + ':\'
  $expectedMachine = if ($Arch -eq 'arm64') { 0xAA64 } else { 0x8664 }
  $expectedMachineText = '0x{0:X4}' -f $expectedMachine
  $srcWinloadMachine = Get-PeMachine ($srcDir + 'Windows\System32\winload.efi')
  if ($srcWinloadMachine -ne $expectedMachine) {
    throw ('源 VHD 架构与 -Arch ' + $Arch + ' 不一致：winload.efi = 0x' + ('{0:X4}' -f $srcWinloadMachine))
  }
  Write-Host ('源镜像架构: ' + $expectedMachineText)

  Write-Host '--- 捕获 Windows 到中转镜像（约 10-25 分钟）---'
  & dism.exe /English /Capture-Image /ImageFile:$wim /CaptureDir:$srcDir /Name:'BATCAVE-Win11-Pro' /Compress:max /LogPath:(Join-Path $outDir 'dism-capture.log')
  if ($LASTEXITCODE -ne 0) { throw ('DISM 捕获失败: ' + $LASTEXITCODE) }

  Write-Host '--- 重建 USB 分区（GPT: EFI + NTFS）---'
  $usbEfi = Get-FreeLetter @($vhdLetter)
  $usbWin = Get-FreeLetter @($vhdLetter, $usbEfi)
  @"
select disk $DiskNumber
clean
convert gpt
create partition efi size=300
format quick fs=fat32 label=SYSTEM
assign letter=$usbEfi
create partition primary
format quick fs=ntfs label=BATCAVE
assign letter=$usbWin
exit
"@ | Out-File -FilePath $dp -Encoding ASCII
  & diskpart.exe /s $dp
  if ($LASTEXITCODE -ne 0) { throw ('diskpart 分区失败: ' + $LASTEXITCODE) }
  if (-not (Test-Path ($usbWin + ':\')) -or -not (Test-Path ($usbEfi + ':\'))) { throw 'USB 分区未成功挂载。' }
  $dstDir = $usbWin + ':\'

  Write-Host '--- 展开 Windows 到 USB（约 15-40 分钟）---'
  & dism.exe /English /Apply-Image /ImageFile:$wim /Index:1 /ApplyDir:$dstDir /LogPath:(Join-Path $outDir 'dism-usb-apply.log')
  if ($LASTEXITCODE -ne 0) { throw ('DISM 展开失败: ' + $LASTEXITCODE) }

  Write-Host '--- 写入 UEFI 引导 ---'
  & bcdboot.exe ($usbWin + ':\Windows') /s ($usbEfi + ':') /f UEFI /l zh-cn
  if ($LASTEXITCODE -ne 0) { throw ('bcdboot 失败: ' + $LASTEXITCODE) }
  $usbBootMgr = $usbEfi + ':\EFI\Microsoft\Boot\bootmgfw.efi'
  if ($Arch -eq 'arm64') {
    Write-Host '--- 替换为 ARM64 引导文件 ---'
    $armBootDir = Join-Path $srcDir 'Windows\Boot\EFI'
    if (-not (Test-Path (Join-Path $armBootDir 'bootmgfw.efi'))) { throw '源 VHD 中缺少 ARM64 bootmgfw.efi。' }
    foreach ($name in @('bootmgfw.efi', 'bootmgr.efi', 'memtest.efi', 'SecureBootRecovery.efi')) {
      $src = Join-Path $armBootDir $name
      if (Test-Path $src) { Copy-Item $src ($usbEfi + ':\EFI\Microsoft\Boot\' + $name) -Force }
    }
    Remove-Item ($usbEfi + ':\EFI\Boot\bootx64.efi') -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path ($usbEfi + ':\EFI\Boot') | Out-Null
    Copy-Item (Join-Path $armBootDir 'bootmgfw.efi') ($usbEfi + ':\EFI\Boot\bootaa64.efi') -Force
  }
  $usbBootMgrMachine = Get-PeMachine $usbBootMgr
  if ($usbBootMgrMachine -ne $expectedMachine) {
    throw ('USB bootmgfw.efi 架构不匹配: 0x' + ('{0:X4}' -f $usbBootMgrMachine))
  }

  Write-Host '--- 复制使用说明 ---'
  $readme = Join-Path $PSScriptRoot 'README-FIRST.txt'
  if (Test-Path $readme) { Copy-Item $readme (Join-Path ($usbWin + ':\') 'BATCAVE-USB-README.txt') -Force }

  $usbNode = $usbWin + ':\BATCAVE-OS\node.exe'
  $usbNodeMachine = if (Test-Path $usbNode) { Get-PeMachine $usbNode } else { 0 }
  $fallbackFile = if ($Arch -eq 'arm64') { 'bootaa64.efi' } else { 'bootx64.efi' }
  $checks = [ordered]@{
    arch = $Arch
    usbDisk = $DiskNumber
    usbSizeGB = [math]::Round($usb.Size / 1GB, 1)
    bootmgfw = Test-Path $usbBootMgr
    bootMgrMachine = '0x{0:X4}' -f $usbBootMgrMachine
    bcd = Test-Path ($usbEfi + ':\EFI\Microsoft\Boot\BCD')
    fallbackBoot = Test-Path ($usbEfi + ':\EFI\Boot\' + $fallbackFile)
    winload = Test-Path ($usbWin + ':\Windows\System32\winload.efi')
    serverJs = Test-Path ($usbWin + ':\BATCAVE-OS\server.js')
    nodeExe = Test-Path $usbNode
    nodeMachine = '0x{0:X4}' -f $usbNodeMachine
    archOk = ($usbBootMgrMachine -eq $expectedMachine) -and ($usbNodeMachine -eq $expectedMachine)
  }
  ($checks | ConvertTo-Json) | Set-Content -Path (Join-Path $outDir 'DEPLOY-USB.json') -Encoding UTF8
  $ok = $checks.bootmgfw -and $checks.bcd -and $checks.fallbackBoot -and $checks.winload -and $checks.serverJs -and $checks.nodeExe -and $checks.archOk
  Write-Host ('DEPLOY OK: ' + $ok)
  if (-not $ok) { throw '部署后校验未通过，请检查日志。' }
  Write-Host '现在可从该 U 盘 UEFI 启动。首次进入 OOBE，请创建本地账户并自行激活 Windows。'
}
catch {
  Write-Host ('DEPLOY FAILED: ' + $_.Exception.Message)
  exit 1
}
finally {
  if ($vhdAttached) {
    @"
select vdisk file="$Vhd"
detach vdisk
exit
"@ | Out-File -FilePath $dp -Encoding ASCII
    & diskpart.exe /s $dp | Out-Null
  }
  Remove-Item $dp, $wim -Force -ErrorAction SilentlyContinue
  Stop-Transcript | Out-Null
}
