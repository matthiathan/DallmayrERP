@echo off
setlocal EnableExtensions
set "APPDIR=%LOCALAPPDATA%\Dallmayr\RFIDCardManager"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP%\RFID Card Manager.cmd"
set "BOOT=%APPDIR%\RFIDManager.ps1"
set "CORE=%APPDIR%\RFIDManagerCore.ps1"
set "RAWBASE=https://raw.githubusercontent.com/matthiathan/DallmayrERP/main/tools/rfid-card-manager/v4"

echo ==================================================
echo Dallmayr RFID Card Manager v4 - Composite USB Setup
echo ==================================================
echo.
echo Installs for the current Windows account only.
echo No Python, pip or Arduino Wi-Fi is required.
echo USB mode: CDC serial + optional HID keyboard wedge.
echo.

if not exist "%APPDIR%" mkdir "%APPDIR%"

if exist "%~dp0RFIDManager.bootstrap.ps1" (
  copy /Y "%~dp0RFIDManager.bootstrap.ps1" "%BOOT%" >nul
) else (
  echo Downloading v4 bootstrap...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%RAWBASE%/RFIDManager.bootstrap.ps1' -OutFile '%BOOT%' -TimeoutSec 12; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
  if errorlevel 1 goto :failed
)

if exist "%~dp0RFIDManager.ps1" (
  copy /Y "%~dp0RFIDManager.ps1" "%CORE%" >nul
)

if not exist "%BOOT%" goto :failed

> "%LAUNCHER%" echo @echo off
>>"%LAUNCHER%" echo start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%BOOT%"

> "%APPDIR%\installed.txt" echo Dallmayr RFID Card Manager v4 installed %DATE% %TIME%

echo Stopping older RFID Manager instances...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process ^| Where-Object { ($_.CommandLine -like '*RFIDManager.ps1*' -or $_.CommandLine -like '*RFIDManagerCore.ps1*') -and $_.ProcessId -ne $PID } ^| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo Starting RFID Manager v4...
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%BOOT%"

echo.
echo Installation complete.
echo Leave the reader connected. The scanning page will open automatically
echo when the USB reader is detected.
echo.
echo Local scanner: http://localhost:8765
pause
exit /b 0

:failed
echo.
echo Installation failed. Check the internet connection or run this installer
echo from the complete RFID Localhost Manager v4 folder.
echo.
pause
exit /b 1
