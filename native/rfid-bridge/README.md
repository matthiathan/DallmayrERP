# Dallmayr RFID Bridge

Windows desktop bridge for the ESP32 DevKit + CP2102 + MFRC522 reader.

## Operator experience

After one installation, the bridge starts with Windows and stays hidden in the background. When a supported RFID reader is plugged in:

1. Windows exposes the CP2102 serial port.
2. The bridge finds CP2102 devices automatically.
3. It opens each candidate at 115200 baud and sends `PING`.
4. Only a device that replies as `Dallmayr RFID Reader` is accepted.
5. The RFID window opens automatically.
6. Card scans appear immediately with `ID (dec)` and `ID (reverse dec)` kept as text.

No ESP32 Wi-Fi access point, Web Serial permission, COM-port selection, Excel, or browser setup is required.

## Expected firmware

Use `hardware/rfid-reader/ESP32_RFID_USB_Serial.ino`.

The bridge understands these firmware commands:

- `PING`
- `READ`
- `WRITE|<up to 16 printable characters>`
- `CANCEL`

The firmware sends one JSON object per line at 115200 baud.

## Build the Windows installer

On a Windows development PC with Node.js installed:

```powershell
cd native\rfid-bridge
npm install
npm run make
```

Electron Forge creates the Squirrel installer under `out\make\squirrel.windows\x64\`.

The installer file is configured as:

```text
Dallmayr-RFID-Setup.exe
```

## First installation

1. Run `Dallmayr-RFID-Setup.exe` once.
2. Launch **Dallmayr RFID Bridge** if it does not launch automatically.
3. Plug in the RFID reader.
4. The reader window should open and show the COM port as connected.

The app registers itself to start at Windows sign-in with `--hidden`. During ordinary operation it stays hidden until a valid Dallmayr RFID reader is detected.

## CP2102 driver

The bridge depends on Windows exposing the CP2102 as a COM port. If a PC shows the CP2102 in Device Manager with Code 28, install the Silicon Labs CP210x VCP driver first. Driver redistribution is intentionally not bundled in this project.

## Scan storage

Scan history is kept locally in the app's browser storage. IDs are strings, so leading zeroes in reverse DEC are preserved. CSV export is optional and does not drive the normal scanning workflow.
