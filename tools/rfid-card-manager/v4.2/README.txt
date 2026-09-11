DALLMAYR RFID CARD MANAGER v4.2
===============================

This version fixes the repeated-install problem.

KEY FIX
-------
After the UNO R4 successfully handshakes with RFID Manager once, firmware v4.2
stores a persistent companion-confirmed marker in the UNO R4 EEPROM-backed data
storage. Future USB reconnects will never reopen the installer because of a
slow Windows startup or delayed COM port.

FIRST INSTALL
-------------
1. Flash RFID_Card_Reader_Composite_v4_2.ino.
2. Close Arduino Serial Monitor.
3. Run Install_RFID_Manager_v4_2.cmd once.
4. Leave the UNO connected for several seconds after installation.
5. The manager should connect and the UNO stores the confirmed marker.
6. Unplug and reconnect. The localhost scanner should open, not the installer.

NORMAL USE
----------
- Plug reader in -> installed manager is activated -> localhost:8765 opens.
- Scan multiple cards; all scans remain in the table.
- Reverse DEC is always 10 digits with leading zeros retained.
- CSV and XLSX export remain available.
- Optional Keyboard Wedge mode remains available.

TEST CARD
---------
The value 0659663725 is a valid 10-character reverse DEC test value and should
remain exactly 0659663725 everywhere, including Excel export.

RECOVERY
--------
If you intentionally remove/reinstall the Windows companion and need the UNO to
forget its confirmed state, connect over Serial and send:

INSTALL_STATE|CLEAR

Then power-cycle the reader.
