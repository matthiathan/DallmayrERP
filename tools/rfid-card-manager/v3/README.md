# RFID Card Manager v3

This version uses **USB serial + localhost**. The UNO R4 does not create a Wi-Fi hotspot and the PC does not join an Arduino network.

## First-use flow

1. Plug the reader into Windows.
2. The UNO sends a USB handshake and waits about 12 seconds for `RFID Manager`.
3. If the manager replies, the scanning website opens immediately at `http://localhost:8765` and normal operation starts automatically.
4. If it does not reply, the UNO opens the `Install_RFID_Manager.cmd` page in the default browser once for that power-up.
5. Download/run the installer once. Windows requires the user to approve this initial software installation.
6. The installer adds RFID Manager to the current user's Windows Startup folder and starts it immediately.
7. Future reader plug-ins require no setup; as soon as the manager detects the reader over USB, it opens the localhost scanning page automatically.

## Normal use

- Plug the reader in: `http://localhost:8765` opens automatically before any card is scanned.
- Scan cards: each scan is appended to the running table.
- The page stays open for multiple cards instead of opening a new page per scan.
- Reverse DEC is always formatted as exactly **10 digits**, padded with leading zeroes.
- Scan history persists between restarts.
- Export all scans as CSV or a real `.xlsx` Excel file. Reverse DEC is stored as text in Excel so leading zeroes are retained.

## Firmware

Flash `RFID_Card_Reader_AutoSetup_v3.ino` to the UNO R4 WiFi. Required libraries are `SPI`, `MFRC522`, and `Keyboard` from the UNO R4 core.

Close Arduino Serial Monitor after flashing because the Windows RFID Manager needs the USB serial port.

## Windows installation

The install target is:

`%LOCALAPPDATA%\Dallmayr\RFIDCardManager`

The localhost service listens only on `127.0.0.1:8765`.

## USB protocol

```text
Reader -> PC: HELLO|RFID_READER|3.0|UNO_R4
PC -> Reader: HOST|RFID_MANAGER|3|OK
Reader -> PC: PING|RFID_READER|3
PC -> Reader: PONG|RFID_MANAGER|3
```

Scan records use:

```text
RFID|UID HEX|ID DEC|REVERSE DEC 10 DIGITS|CARD TYPE
```

## Windows limitation

A normal USB peripheral cannot silently install arbitrary software simply by being connected. v3 automatically checks whether its companion is running and opens the setup page if it is missing. The user approves the first installation once; after that, plugging the reader in automatically opens the localhost scanning page. A production zero-touch deployment should use a signed MSI/MSIX or a Windows device-companion deployment mechanism.
