param(
  [string]$Vhd = '',
  [string]$Report = ''
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Vhd) { $Vhd = Join-Path $repoRoot 'iso\out\BATCAVE-Win11-Pro.vhd' }
if (-not $Report) { $Report = Join-Path $repoRoot 'iso\out\INSPECT.json' }
$dp = Join-Path $env:TEMP ('bc-inspect-' + [guid]::NewGuid().ToString('N') + '.txt')
$dp2 = Join-Path $env:TEMP ('bc-inspect2-' + [guid]::NewGuid().ToString('N') + '.txt')
$out = [ordered]@{}
$attached = $false
try {
  @"
select vdisk file="$Vhd"
attach vdisk readonly
exit
"@ | Out-File -FilePath $dp -Encoding ASCII
  & diskpart.exe /s $dp | Out-Null
  $attached = $true
  Start-Sleep -Seconds 1
  $disk = Get-DiskImage -ImagePath $Vhd | Get-Disk
  $parts = Get-Partition -DiskNumber $disk.Number | Sort-Object PartitionNumber
  $out.partitions = @($parts | ForEach-Object {
    [ordered]@{
      number = $_.PartitionNumber
      type = $_.Type
      sizeMB = [math]::Round($_.Size / 1MB)
      drive = $_.DriveLetter
      offset = $_.Offset
    }
  })
  $efi = $parts | Where-Object { $_.Type -eq 'System' -or $_.GptType -eq '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}' } | Select-Object -First 1
  $win = $parts | Where-Object { $_.Type -eq 'Basic' } | Sort-Object Size -Descending | Select-Object -First 1
  $efiLetter = $null; $winLetter = $null
  if ($efi -and -not $efi.DriveLetter) {
    $efiLetter = @('X','Y','Z','V','U') | Where-Object { -not (Test-Path ($_ + ':\')) } | Select-Object -First 1
    if ($efiLetter) { Add-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $efi.PartitionNumber -AccessPath ($efiLetter + ':') -ErrorAction SilentlyContinue }
  } elseif ($efi) { $efiLetter = [string]$efi.DriveLetter }
  if ($win -and -not $win.DriveLetter) {
    $winLetter = @('Y','Z','V','U','T') | Where-Object { -not (Test-Path ($_ + ':\')) -and $_ -ne $efiLetter } | Select-Object -First 1
    if ($winLetter) { Add-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $win.PartitionNumber -AccessPath ($winLetter + ':') -ErrorAction SilentlyContinue }
  } elseif ($win) { $winLetter = [string]$win.DriveLetter }
  Start-Sleep -Seconds 2
  $out.efiLetter = $efiLetter
  $out.winLetter = $winLetter
  $out.volumes = @(Get-Volume | Where-Object { $_.DriveLetter -in @($efiLetter, $winLetter) } | ForEach-Object {
    [ordered]@{ drive = [string]$_.DriveLetter; fs = $_.FileSystem; label = $_.FileSystemLabel; sizeMB = [math]::Round($_.Size / 1MB) }
  })
  if ($efiLetter -and (Test-Path ($efiLetter + ':\'))) {
    $out.efiRoot = @(Get-ChildItem ($efiLetter + ':\') -Force -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    $out.efiFiles = @(Get-ChildItem ($efiLetter + ':\EFI') -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring(3) })
    $out.bootmgfw = Test-Path ($efiLetter + ':\EFI\Microsoft\Boot\bootmgfw.efi')
    $out.bcd = Test-Path ($efiLetter + ':\EFI\Microsoft\Boot\BCD')
    $out.fallbackBoot = Test-Path ($efiLetter + ':\EFI\Boot\bootx64.efi')
  }
  if ($winLetter -and (Test-Path ($winLetter + ':\'))) {
    $out.winRoot = @(Get-ChildItem ($winLetter + ':\') -Force -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    $out.winload = Test-Path ($winLetter + ':\Windows\System32\winload.efi')
  }
  ($out | ConvertTo-Json -Depth 6) | Set-Content -Path $Report -Encoding UTF8
  Write-Host ('REPORT: ' + $Report)
}
catch {
  $out.error = $_.Exception.Message
  ($out | ConvertTo-Json -Depth 6) | Set-Content -Path $Report -Encoding UTF8
  Write-Host ('INSPECT FAILED: ' + $_.Exception.Message)
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
