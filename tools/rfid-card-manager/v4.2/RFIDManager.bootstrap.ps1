# Dallmayr RFID Manager v4.2 bootstrap
$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'Dallmayr\RFIDCardManager'
$core=Join-Path $root 'RFIDManagerCore.ps1'
$base='https://raw.githubusercontent.com/matthiathan/DallmayrERP/main/tools/rfid-card-manager/v4'
New-Item -ItemType Directory -Force -Path $root | Out-Null

# Normal installed path: start cached runtime immediately. Never make USB
# startup wait for GitHub/network access.
if(Test-Path -LiteralPath $core){
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $core
  exit $LASTEXITCODE
}

# First install / missing cache only: recover the existing v4 runtime once.
$sb=[Text.StringBuilder]::new()
1..8 | ForEach-Object {
  $u="$base/RFIDManager.part$_.txt"
  $t=(Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 8).Content
  [void]$sb.Append($t)
}
[IO.File]::WriteAllText($core,$sb.ToString(),[Text.UTF8Encoding]::new($false))
& powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $core
