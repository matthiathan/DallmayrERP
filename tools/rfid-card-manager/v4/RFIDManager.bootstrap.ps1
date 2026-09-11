# Dallmayr RFID Manager v4 bootstrap/updater
$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'Dallmayr\RFIDCardManager'
$core=Join-Path $root 'RFIDManagerCore.ps1'
$base='https://raw.githubusercontent.com/matthiathan/DallmayrERP/main/tools/rfid-card-manager/v4'
New-Item -ItemType Directory -Force -Path $root | Out-Null

# Refresh the runtime when internet is available. If offline, keep using the
# most recently cached copy so scanning still works without internet.
try {
  $sb=[Text.StringBuilder]::new()
  1..8 | ForEach-Object {
    $u="$base/RFIDManager.part$_.txt"
    $t=(Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 8).Content
    [void]$sb.Append($t)
  }
  $tmp="$core.new"
  [IO.File]::WriteAllText($tmp,$sb.ToString(),[Text.UTF8Encoding]::new($false))
  Move-Item -Force $tmp $core
} catch {
  if(-not (Test-Path -LiteralPath $core)){ throw }
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $core
