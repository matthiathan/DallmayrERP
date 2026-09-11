# RFID Card Manager v5 - No Install

This version removes the Windows companion application completely.

## User flow

1. Plug the UNO R4 RFID reader into a Windows PC.
2. The reader opens `https://dallmayrerp.onrender.com/rfid-scanner` in the default browser using standard USB HID keyboard support.
3. Scan MIFARE Classic cards.
4. Each card appears in the browser table immediately.
5. Scans remain in that browser using localStorage until the user clears them.
6. Export the list as CSV for Excel whenever required.

No localhost service, Python, PowerShell installer, Arduino hotspot or browser serial permission is required.

## Scan protocol

The firmware types one line followed by Enter:

```text
RFID|UID HEX|ID DEC|REVERSE DEC 10 DIGITS|CARD TYPE
```

Example:

```text
RFID|27 58 A1 3D|1033984039|0661181549|MIFARE 1KB
```

The browser independently forces the Reverse DEC field to exactly 10 digits before storing it.

## Important

- Current automatic-open shortcut targets Windows (`Win+R`).
- The PC needs internet access to load the hosted scanner page.
- The scanner page is intentionally public, while the rest of DallmayrERP remains login-protected.
- If the page is already open, reconnecting the reader opens it again because HID-only mode has no safe way to query whether an existing browser tab is active.
