@echo off
setlocal EnableExtensions
set "APPDIR=%LOCALAPPDATA%\Dallmayr\RFIDCardManager"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTLAUNCHER=%STARTUP%\RFID Card Manager.cmd"
set "BOOT=%APPDIR%\RFIDManager.ps1"
set "CORE=%APPDIR%\RFIDManagerCore.ps1"
set "OPENPS=%APPDIR%\Open_RFID_Manager.ps1"
set "RAWBASE=https://raw.githubusercontent.com/matthiathan/DallmayrERP/main/tools/rfid-card-manager/v4.2"

echo ==================================================
echo Dallmayr RFID Card Manager v4.2 - USB Setup
echo ==================================================
echo.
echo This is a one-time installation for the current Windows account.
echo Future USB reconnects must NOT reopen this installer.
echo.

if not exist "%APPDIR%" mkdir "%APPDIR%"

rem Prefer the complete local package. Only download missing files when the
rem installer was launched by itself from GitHub.
if exist "%~dp0RFIDManager.bootstrap.ps1" (
  copy /Y "%~dp0RFIDManager.bootstrap.ps1" "%BOOT%" >nul
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%RAWBASE%/RFIDManager.bootstrap.ps1' -OutFile '%BOOT%' -TimeoutSec 12; exit 0 } catch { exit 1 }"
  if errorlevel 1 goto :failed
)

if exist "%~dp0RFIDManager.ps1" (
  copy /Y "%~dp0RFIDManager.ps1" "%CORE%" >nul
) else if not exist "%CORE%" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$b='https://raw.githubusercontent.com/matthiathan/DallmayrERP/main/tools/rfid-card-manager/v4';$o='%CORE%';$sb=[Text.StringBuilder]::new();try{1..8|%%{$t=(Invoke-WebRequest -UseBasicParsing ($b+'/RFIDManager.part'+$_+'.txt') -TimeoutSec 8).Content;[void]$sb.Append($t)};[IO.File]::WriteAllText($o,$sb.ToString(),[Text.UTF8Encoding]::new($false));exit 0}catch{exit 1}"
  if errorlevel 1 goto :failed
)

if exist "%~dp0Open_RFID_Manager.ps1" (
  copy /Y "%~dp0Open_RFID_Manager.ps1" "%OPENPS%" >nul
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%RAWBASE%/Open_RFID_Manager.ps1' -OutFile '%OPENPS%' -TimeoutSec 12; exit 0 } catch { exit 1 }"
  if errorlevel 1 goto :failed
)

if not exist "%BOOT%" goto :failed
if not exist "%CORE%" goto :failed
if not exist "%OPENPS%" goto :failed

rem Start automatically at Windows sign-in.
> "%STARTLAUNCHER%" echo @echo off
>>"%STARTLAUNCHER%" echo start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%BOOT%"

rem Register a per-user custom protocol. The Arduino opens dallmayrrfid://open
rem on USB plug-in. If this registration exists, Windows starts the already-
rem installed local companion instead of sending the user to setup again.
reg add "HKCU\Software\Classes\dallmayrrfid" /ve /d "URL:Dallmayr RFID Manager" /f >nul
if errorlevel 1 goto :failed
reg add "HKCU\Software\Classes\dallmayrrfid" /v "URL Protocol" /d "" /f >nul
if errorlevel 1 goto :failed
reg add "HKCU\Software\Classes\dallmayrrfid\shell\open\command" /ve /d "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%OPENPS%\" \"%%1\"" /f >nul
if errorlevel 1 goto :failed

rem Verify the protocol registration really exists before claiming success.
reg query "HKCU\Software\Classes\dallmayrrfid\shell\open\command" /ve >nul 2>nul
if errorlevel 1 goto :failed

> "%APPDIR%\installed.txt" echo Dallmayr RFID Card Manager v4.2 installed %DATE% %TIME%

echo Stopping older RFID Manager instances...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process ^| Where-Object { ($_.CommandLine -like '*RFIDManager.ps1*' -or $_.CommandLine -like '*RFIDManagerCore.ps1*') -and $_.ProcessId -ne $PID } ^| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo Starting RFID Manager v4.2...
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%BOOT%"

echo.
echo Installation complete.
echo.
echo IMPORTANT: leave the UNO connected for a few seconds so it receives one
echo successful RFID Manager handshake. Firmware v4.2 permanently remembers
echo that success and will never reopen setup on normal reconnects afterwards.
echo.
echo Local scanner: http://localhost:8765
echo.
pause
exit /b 0

:failed
echo.
echo Installation did not complete successfully.
echo Nothing has been marked as successfully installed.
echo Run this installer again from the complete v4.2 folder.
echo.
pause
exit /b 1
