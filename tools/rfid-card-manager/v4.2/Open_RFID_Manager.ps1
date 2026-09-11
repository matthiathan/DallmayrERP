$ErrorActionPreference='SilentlyContinue'
$url='http://localhost:8765/'
$root=Join-Path $env:LOCALAPPDATA 'Dallmayr\RFIDCardManager'
$boot=Join-Path $root 'RFIDManager.ps1'

# If already running, simply show the scanner.
try {
  Invoke-WebRequest -UseBasicParsing ($url+'api/state') -TimeoutSec 1 | Out-Null
  Start-Process $url
  exit 0
} catch {}

# Start the cached installed manager asynchronously.
if(Test-Path -LiteralPath $boot){
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"'+$boot+'"')
  )
}

# Give localhost a short opportunity to come up, then open it.
for($i=0; $i -lt 25; $i++){
  Start-Sleep -Milliseconds 200
  try {
    Invoke-WebRequest -UseBasicParsing ($url+'api/state') -TimeoutSec 1 | Out-Null
    Start-Process $url
    exit 0
  } catch {}
}
exit 0
