# RFID Manager v3 bootstrap
$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'Dallmayr\RFIDCardManager'
$core=Join-Path $root 'RFIDManagerCore.ps1'
$base='https://raw.githubusercontent.com/matthiathan/DallmayrERP/main/tools/rfid-card-manager/v3'
New-Item -ItemType Directory -Force -Path $root | Out-Null
if(-not (Test-Path -LiteralPath $core)){
  $sb=[Text.StringBuilder]::new()
  1..4 | ForEach-Object {
    $u="$base/RFIDManager.part$_.txt"
    $t=(Invoke-WebRequest -UseBasicParsing $u).Content
    [void]$sb.Append($t)
  }
  [IO.File]::WriteAllText($core,$sb.ToString(),[Text.UTF8Encoding]::new($false))
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $core
