# Dallmayr Telemetry Hardware Rev-B — isolated field design

Status: **architecture / safety contract**. This is the next hardware revision after the prototype used during the Rheavendors XS Grande test. It is **not yet a manufacturing release** and must not be treated as approved Gerber/schematic output until the electrical validation checklist in this folder has passed.

## Why Rev-B exists

The prototype software is now capable of passive MDB decoding and selection Learn Mode, but the live-machine test exposed an earth-leakage/RCD event. The next PCB therefore treats galvanic separation as a hard design requirement rather than an optional improvement.

The MDB/ICP specification defines the VMC supply as approximately 20 V minimum, 34 V nominal unregulated, 42.5 V maximum ripple, with high-line peaks that may approach 45 V. It also defines MDB signalling as an optically isolated 5 V current-loop interface. The Rev-B board must therefore tolerate the full machine rail and must not expose raw MDB conductors to ESP32 GPIO or USB ground.

Reference: MDB/ICP v4.3 hardware specification, section 4 (bus power and isolated current-loop interface).

## Electrical domains

Rev-B has two intentionally separated domains.

### MACHINE domain

- `MACH_34V_IN` — MDB pin 1 power rail.
- `MACH_PWR_RETURN` — MDB pin 2 power return.
- MDB pin 3 — N/C.
- `MDB_MASTER_RX_RAW` — MDB pin 4.
- `MDB_MASTER_TX_RAW` — MDB pin 5.
- `MDB_COMM_COMMON` — MDB pin 6 communications common.
- `DEX_RS232_TX_MACHINE` / `DEX_RS232_RX_MACHINE` / `DEX_RS232_COMMON` — machine-side DEX.

### LOGIC domain

- `ISO_5V` — isolated regulated 5 V rail.
- `LOGIC_GND` — isolated logic ground.
- `3V3_LOGIC` — ESP32 logic rail.
- `USB_GND` — belongs to the LOGIC domain only.
- ESP32-S3, Air780E/Air780EU UART and all service/debug connections live here.

There must be **no intentional DC copper path** from `MACH_PWR_RETURN` or `MDB_COMM_COMMON` to `LOGIC_GND` / `USB_GND`.

## Power architecture

```text
MDB pin 1 / MACH_34V_IN
        |
     fuse/PTC
        |
 reverse-polarity protection
        |
 surge / transient clamp + input filter
        |
 18–75 V isolated DC/DC, >= 15 W
        |
      ISO_5V  ----> Air780E/Air780EU external power input
        |
      3.3 V regulator
        |
      ESP32-S3

MDB pin 2 / MACH_PWR_RETURN terminates on the input side of the isolated DC/DC only.
```

### Isolated DC/DC requirement

Minimum design requirement:

- Input operating range: **18–75 VDC or wider**.
- Output: **5 VDC, at least 3 A / 15 W** for the Rev-B prototype.
- Reinforced/basic isolation component rating: **>= 1.5 kVDC**, with 2 kV+ preferred.
- Required protections: UVLO, current limiting/over-current, short-circuit; OVP/OTP preferred.
- Output bulk capacitance must be sized from the converter and modem manufacturers' stability/inrush limits.

Current reference candidate: **Murata UEI15-050-Q48N-C** (18–75 V input, 5 V/3 A, 15 W, 2.25 kV isolation). It is a validation candidate, not a locked production part.

A smaller 8 W module is not the default because the cellular modem and ESP32 can create short high-current demand. The Rev-B power budget is deliberately conservative until measured on the bench.

## MDB receive architecture

The firmware remains passive: GPIO4 and GPIO5 are input-only.

```text
MDB pin 5 / Master-TX raw ---- protected high-impedance MACHINE-side receiver ---- isolation ---- GPIO4
MDB pin 4 / Master-RX raw ---- protected high-impedance MACHINE-side receiver ---- isolation ---- GPIO5
MDB pin 6 / Comm Common  ----- MACHINE-side receiver reference only
```

Requirements:

1. Raw MDB conductors never reach the ESP32 side.
2. The sensing front-end must not materially load or drive the current-loop bus.
3. Both receive paths must preserve the 9600 baud MDB waveform and mode-bit timing used by the ESP32 RMT decoder.
4. The machine-side receiver must tolerate wiring errors and normal vending-machine transients.
5. The isolation barrier must maintain the PCB creepage/clearance required by the selected isolator package and board process.
6. **No active MDB transmit path is fitted in Rev-B.** Learn Mode remains observation-only.

The exact current-loop sensing component values are intentionally not frozen here. They must be selected from the MDB electrical specification and verified on an MDB simulator/known-good machine before Gerber release. A passive sniffer that changes bus current is not acceptable.

## DEX architecture

The previous `SP3232EET` approach translates RS-232 levels but is not galvanically isolated. Rev-B changes the field DEX interface to a fully isolated RS-232 channel.

Reference candidate: **Analog Devices ADM3251E**, which integrates isolated power and an isolated 1 Tx / 1 Rx RS-232 transceiver.

```text
Machine DEX ---- isolated RS-232 transceiver ---- GPIO17 / GPIO18
```

Firmware pin contract remains:

- GPIO17: ESP32 DEX RX.
- GPIO18: ESP32 DEX TX.

## Cellular and ESP32 pin contract

The Rev-B carrier preserves the firmware pin assignments already compiled in V6.8.49:

| Function | ESP32-S3 GPIO |
|---|---:|
| Air780 TX -> ESP32 RX | 1 |
| ESP32 TX -> Air780 RX | 2 |
| MDB Master-TX passive copy | 4 |
| MDB Master-RX passive copy | 5 |
| DEX RX | 17 |
| DEX TX | 18 |

Any PCB change to these pins requires a matching firmware change and CI compile before manufacture.

## USB / service-port rule

USB belongs entirely to the LOGIC domain. A connected laptop, charger, oscilloscope or USB/UART adapter must **not** create continuity from USB ground to any machine-side MDB/DEX reference.

For service/debug test points:

- expose `ISO_5V`, `3V3_LOGIC`, `LOGIC_GND`, GPIO4 and GPIO5 only on the logic side;
- expose machine-domain test points separately and clearly marked;
- do not place a generic ground test point across the isolation barrier.

## Mechanical target

The original approximate 30 x 30 mm target remains a **future optimisation target**, not a Rev-B safety constraint.

A certified 15 W isolated 18–75 V to 5 V/3 A module is already roughly the size of the original board target. The first isolated validation PCB should therefore use a larger outline that permits correct creepage, protection components, modem power bulk capacitance and accessible test points. Once the circuit is electrically proven, a later Rev-C can replace the module with a custom isolated converter if size reduction is still required.

## Release gates

No Rev-B Gerber package is considered production-ready until all of the following are true:

1. Schematic review confirms there is no direct machine-ground to logic-ground connection.
2. The automated hardware contract check passes.
3. Bare-board continuity/isolation inspection passes.
4. Bench power tests pass at 20 V, 34 V, 42.5 V and a controlled transient test representing the specified high-line condition.
5. Air780EU PPP upload succeeds repeatedly while monitoring the 5 V rail for droop/reset.
6. MDB capture works through the isolated receiver without changing machine operation.
7. DEX works through the isolated RS-232 interface.
8. USB-connected debugging does not establish a machine-to-protective-earth path.
9. Only after the above: controlled vending-machine field trial under qualified supervision.

See `commissioning-checklist.md`, `safety-contract.json` and `bom.csv` in this folder.