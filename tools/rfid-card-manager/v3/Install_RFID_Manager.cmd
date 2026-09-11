@echo off
setlocal EnableExtensions
set "APPDIR=%LOCALAPPDATA%\Dallmayr\RFIDCardManager"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP%\RFID Card Manager.cmd"
set "RAWBASE=https://raw.githubusercontent.com/matthiathan/DallmayrERP/main/tools/rfid-card-manager/v3"

echo ==================================================
echo Dallmayr RFID Card Manager v3 - One-Time Setup
echo ==================================================
echo.
echo This installs only for your Windows account.
echo No Python or Arduino Wi-Fi is required.
echo.

if not exist "%APPDIR%" mkdir "%APPDIR%"

if exist "%~dp0RFIDManager.ps1" (
  echo Installing local companion file...
  copy /Y "%~dp0RFIDManager.ps1" "%APPDIR%\RFIDManager.ps1" >nul
) else (
  echo Downloading RFID Manager companion from GitHub...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%RAWBASE%/RFIDManager.ps1' -OutFile '%APPDIR%\RFIDManager.ps1'; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
  if errorlevel 1 goto :failed
)

if not exist "%APPDIR%\RFIDManager.ps1" goto :failed

echo Creating automatic Windows startup entry...
> "%LAUNCHER%" echo @echo off
>>"%LAUNCHER%" echo start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%APPDIR%\RFIDManager.ps1"

> "%APPDIR%\installed.txt" echo RFID Card Manager v3 installed %DATE% %TIME%

echo Stopping an older manager instance if present...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process ^| Where-Object { $_.CommandLine -like '*RFIDManager.ps1*' -and $_.ProcessId -ne $PID } ^| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo Starting RFID Card Manager...
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%APPDIR%\RFIDManager.ps1"

echo.
echo Installation complete.
echo.
echo Plug in / leave the UNO R4 connected. The manager will answer the
echo reader handshake automatically. Scan a card to open localhost.
echo.
echo Local page: http://localhost:8765
start "" "http://localhost:8765"
echo.
pause
exit /b 0

:failed
echo.
echo Installation failed because RFIDManager.ps1 could not be installed.
echo Check the internet connection or run this installer from the complete v3 folder.
echo.
pause
exit /b 1
