# Dallmayr RFID Card Manager v4

**Composite USB: CDC Serial + HID Keyboard**

This version turns the Arduino UNO R4 WiFi + MFRC522 reader into a composite-style USB RFID reader using one USB-C cable:

1. USB CDC serial carries structured RFID data to the Windows localhost manager.
2. USB HID keyboard is available as an optional keyboard-wedge output.

The localhost page remains the primary interface and always stores scans.

## Normal use

1. Plug the RFID reader into the Windows PC.
2. RFID Manager verifies the USB reader and immediately opens `http://localhost:8765`.
3. Scan cards. Every scan is appended to the table.
4. Reverse DEC is always exactly 10 digits with zeros padded on the left.
5. Export the complete list to CSV or Excel `.xlsx` whenever required.

## Keyboard Wedge mode

The localhost page contains a **Keyboard Wedge** toggle.

When OFF (default), scans are recorded only by the localhost manager and the reader does not type into Windows applications.

When ON, scans are still recorded by localhost and the reader also types the 10-digit Reverse DEC into whichever application currently has focus. **Enter after scan** can be enabled or disabled independently.

Use Keyboard Wedge carefully: if it is ON, a scan types into the currently focused window just like a commercial USB barcode/RFID keyboard reader.

## First install

Windows does not allow a normal USB device to silently install arbitrary software. The first time the reader is connected without RFID Manager installed, the firmware waits about 12 seconds and opens the GitHub installer page using HID keyboard emulation. The user runs/approves `Install_RFID_Manager_v4.cmd` once.

After installation, future plug-ins are automatic.

## Files

- `RFID_Card_Reader_Composite_v4.ino` — flash this to the UNO R4 WiFi.
- `Install_RFID_Manager_v4.cmd` — one-time Windows installation.
- `RFIDManager.bootstrap.ps1` — startup updater; refreshes the runtime from GitHub when online and uses the cached copy when offline.
- `RFIDManager.part1.txt` through `RFIDManager.part8.txt` — the Windows localhost runtime.

## Arduino libraries

- SPI
- MFRC522
- Keyboard (included with the UNO R4 board core)

## RC522 wiring

- SDA / SS → D10
- SCK → D13
- MOSI → D11
- MISO → D12
- IRQ → not connected
- GND → GND
- RST → D9
- 3.3V → 3.3V

## USB protocol v4

Reader → PC:

```text
HELLO|RFID_READER|4.0|UNO_R4|CDC_HID
```

PC → Reader:

```text
HOST|RFID_MANAGER|4|OK
```

Heartbeat:

```text
PING|RFID_READER|4
PONG|RFID_MANAGER|4
```

Mode control:

```text
MODE|HID|ON
MODE|HID|OFF
MODE|ENTER|ON
MODE|ENTER|OFF
GET|STATUS
```

Reader mode report:

```text
DEVICE|STATUS|HID=0|ENTER=1
```

Scan record:

```text
RFID|UID HEX|ID DEC|REVERSE DEC 10 DIGITS|CARD TYPE
```

## Upgrade compatibility

v4 firmware accepts the v3 host handshake, and the v4 Windows manager recognizes v3 firmware. This allows firmware and Windows software to be upgraded in either order.

## Test procedure

1. Flash `RFID_Card_Reader_Composite_v4.ino`.
2. Close Arduino Serial Monitor so the Windows manager can use the COM port.
3. Run `Install_RFID_Manager_v4.cmd` once.
4. Unplug and reconnect the UNO R4.
5. The localhost page should open automatically when the reader is verified.
6. Scan several cards and confirm each appears in the table.
7. Confirm Reverse DEC values are 10 digits.
8. Export Excel and verify leading zeros are preserved.
9. Turn Keyboard Wedge ON, click into Notepad/Excel, scan a card, and confirm the same 10-digit Reverse DEC is typed there while also appearing in localhost history.
