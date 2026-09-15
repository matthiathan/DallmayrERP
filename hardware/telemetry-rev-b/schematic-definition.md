# Dallmayr Telemetry Rev-B — component-level schematic definition

Status: **design input / pre-CAD schematic freeze**

This document defines the electrical blocks, named nets and component-level connections that the Rev-B schematic must implement. It is intentionally stricter than a block diagram but is **not yet a KiCad schematic or manufacturing release**.

The two hard constraints are:

1. machine-side MDB/DEX references must remain galvanically isolated from the ESP32/USB logic domain; and
2. MDB remains passive-only. No Rev-B component may actively drive the MDB bus.

---

## 1. Net domains

### MACHINE domain

- `MACH_34V_IN` — MDB pin 1.
- `MACH_PWR_RETURN` — MDB pin 2.
- MDB pin 3 — no connection.
- `MDB_MASTER_RX_RAW` — MDB pin 4.
- `MDB_MASTER_TX_RAW` — MDB pin 5.
- `MDB_COMM_COMMON` — MDB pin 6.
- `DEX_RS232_TX_MACHINE`
- `DEX_RS232_RX_MACHINE`
- `DEX_RS232_COMMON`

### LOGIC domain

- `ISO_5V`
- `3V3_LOGIC`
- `LOGIC_GND`
- `USB_GND`
- `CELL_RX_3V3` — GPIO1
- `CELL_TX_3V3` — GPIO2
- `MDB_TX_MON_3V3` — GPIO4
- `MDB_RX_MON_3V3` — GPIO5
- `DEX_RX_3V3` — GPIO17
- `DEX_TX_3V3` — GPIO18

### DEX isolated line-side domain

The isolated RS-232 transceiver creates a third local domain on its RS-232 side:

- `DEX_ISO_GND` — connect to the machine DEX signal common only as required by the machine DEX interface.
- `DEX_RS232_TX_MACHINE`
- `DEX_RS232_RX_MACHINE`

`DEX_ISO_GND` must not be copper-connected to `LOGIC_GND`, `USB_GND`, `MACH_PWR_RETURN` or `MDB_COMM_COMMON`.

---

## 2. MDB connector J1

J1 is a keyed/polarized six-position MDB-compatible connector.

| J1 pin | Net | Rule |
|---|---|---|
| 1 | `MACH_34V_IN` | power-input chain only |
| 2 | `MACH_PWR_RETURN` | isolated converter primary return only |
| 3 | N/C | no copper except pad if mechanically required |
| 4 | `MDB_MASTER_RX_RAW` | passive isolated sensing channel B only |
| 5 | `MDB_MASTER_TX_RAW` | passive isolated sensing channel A only |
| 6 | `MDB_COMM_COMMON` | machine-side MDB receiver reference only |

Do not infer pin function from cable colour. Harness release requires physical connector pin-to-wire continuity verification.

---

## 3. Protected isolated power input

### 3.1 Required chain

```text
J1-1 MACH_34V_IN
  -> F1 input protection
  -> Q1 reverse-polarity / ideal-diode stage
  -> D1 surge clamp network
  -> L1/CIN input filtering
  -> PS1 VIN+

J1-2 MACH_PWR_RETURN
  -----------------> PS1 VIN-

PS1 isolated secondary:
  VOUT+ -> ISO_5V
  VOUT- -> LOGIC_GND
```

There is no intentional copper path around PS1 between its primary and secondary domains.

### 3.2 PS1 reference candidate

**Murata Power Solutions UEI15-050-Q48N-C** is the current Rev-B validation candidate:

- 18–75 VDC input;
- 5 V / 3 A output;
- 15 W;
- 2.25 kV isolation.

This part is large enough that the first validation PCB must prioritise electrical spacing and test access over the original 30 x 30 mm size target.

### 3.3 F1 / Q1 / D1 / filter

The topology is frozen; exact part numbers/values are not yet frozen.

They must be selected together from:

- PS1 absolute-maximum and recommended input network;
- measured cold-start/inrush current;
- valid MDB source capability;
- measured vending-machine transient/source impedance.

Do **not** select a TVS merely by choosing a standoff above 42.5 V. The clamped voltage must remain below the final converter input absolute maximum across the intended surge current.

Input capacitor voltage rating should have meaningful margin above the 45 V high-line condition; 100 V-rated parts are preferred for the validation board where size permits.

---

## 4. 5 V and 3.3 V logic power

### ISO_5V loads

`ISO_5V` feeds:

- Air780E/Air780EU external power input;
- ADM3251E logic-side VCC;
- the 5 V DEX up-translator;
- the ESP32 carrier 5 V input for the validation board, unless the final bare-module regulator topology is selected.

Place local high-frequency decoupling at every IC plus a dedicated low-ESR modem bulk capacitor bank close to the Air780 power connector.

The bulk-capacitance value remains a validation parameter: choose it from measured modem transmit droop and the PS1 stability/inrush limits rather than guessing a large value.

### 3V3_LOGIC

For the first Rev-B carrier, `3V3_LOGIC` may be supplied by the ESP32-S3 development board regulator. A later integrated ESP32 module design must use a dedicated regulator with adequate transient margin.

---

## 5. Cellular interface J_CELL

Firmware contract:

```text
Air780 TX  -> GPIO1 / CELL_RX_3V3
Air780 RX  <- GPIO2 / CELL_TX_3V3
Air780 VCC -> ISO_5V
Air780 GND -> LOGIC_GND
```

The DFRobot Gravity carrier may be used on the validation board. A bare Air780E/EU production integration is a separate power/RF design task and must not be substituted without reviewing the bare-module hardware design requirements.

Provide local UART series-resistor footprints (default DNI or low value) to allow signal-integrity tuning without PCB rework.

---

## 6. DEX isolated RS-232 interface

### 6.1 Isolation device

Current validation candidate: **Analog Devices ADM3251E**.

It provides a fully isolated 1 Tx / 1 Rx RS-232 interface with integrated isolated power and operates from a 5 V logic-side supply.

The ADM3251E logic pins must **not** connect directly to ESP32 GPIO. Its transmitter input requires a high level of 0.7 x VCC and its receiver output can rise close to the 5 V VCC rail. Therefore explicit fixed-direction level translation is required.

### 6.2 ESP32 transmit path: 3.3 V -> 5 V

Use `U_DEX_UP`, candidate **SN74AHCT1G125**, powered from `ISO_5V`.

```text
GPIO18 / DEX_TX_3V3
  -> optional 22–100 ohm series footprint
  -> U_DEX_UP A
U_DEX_UP /OE -> LOGIC_GND
U_DEX_UP VCC -> ISO_5V
U_DEX_UP GND -> LOGIC_GND
U_DEX_UP Y -> DEX_TX_5V
DEX_TX_5V -> ADM3251E TIN
```

AHCT is intentionally used because a 3.3 V ESP32 high exceeds its specified 2.0 V minimum high-level input threshold when operated at 5 V.

### 6.3 ESP32 receive path: 5 V -> 3.3 V

Use `U_DEX_DOWN`, candidate **SN74LVC1G17**, powered from `3V3_LOGIC`.

```text
ADM3251E ROUT -> DEX_RX_5V
DEX_RX_5V -> U_DEX_DOWN A
U_DEX_DOWN VCC -> 3V3_LOGIC
U_DEX_DOWN GND -> LOGIC_GND
U_DEX_DOWN Y -> optional 22–100 ohm series footprint -> GPIO17 / DEX_RX_3V3
```

The LVC input is over-voltage tolerant to 5.5 V, so a 5 V ADM3251E ROUT signal is accepted while its output remains on the 3.3 V rail.

### 6.4 ADM3251E external components

Use the capacitor network and placement required by the current ADM3251E datasheet, including its charge-pump capacitors and logic-side decoupling. Do not substitute values from an older RS-232 transceiver schematic.

On the isolated line side:

```text
ADM3251E TOUT -> DEX_RS232_TX_MACHINE
DEX_RS232_RX_MACHINE -> ADM3251E RIN
ADM3251E GNDISO -> DEX_ISO_GND
```

Add ESD/transient protection only if it is compatible with RS-232 voltage swing and the transceiver manufacturer's application guidance.

---

## 7. Passive MDB sensing channels

### 7.1 Channel A — VMC Master Transmit

```text
MDB_MASTER_TX_RAW
  -> MACHINE-side protection
  -> validated high-impedance/current-loop sensing front end A
  -> galvanic isolation A
  -> 3.3 V logic conditioning
  -> GPIO4 / MDB_TX_MON_3V3
```

Reference on the machine side is `MDB_COMM_COMMON` only as required by the validated MDB receive topology.

### 7.2 Channel B — VMC Master Receive

```text
MDB_MASTER_RX_RAW
  -> MACHINE-side protection
  -> validated high-impedance/current-loop sensing front end B
  -> galvanic isolation B
  -> 3.3 V logic conditioning
  -> GPIO5 / MDB_RX_MON_3V3
```

The two sensing channels are not assumed to be electrically identical. MDB master-transmit and master-receive line behavior must be verified independently.

### 7.3 What is deliberately NOT frozen yet

No optocoupler LED resistor, comparator threshold, pull-up or clamp values are frozen at this stage.

Reason: a passive sniffer must not materially alter the MDB current-loop idle/active current. A seemingly simple optocoupler tap can become a bus load. The sensing network must therefore be validated with an MDB simulator/known-good controller while measuring:

- idle bus current/voltage before and after connection;
- active waveform levels;
- rise/fall timing;
- RMT decode/checksum rate;
- effect on attached cashless/peripheral traffic.

Only after those measurements may the two MDB front ends be marked `schematic_locked`.

### 7.4 Hard prohibition

There is no transistor, open-collector output, analog switch or other circuit from GPIO4/GPIO5/ESP32 into either raw MDB line in Rev-B. The PCB is physically receive-only.

---

## 8. USB and service/debug connector

USB is a LOGIC-domain service connection only.

```text
USB GND == LOGIC_GND
USB GND != MACH_PWR_RETURN
USB GND != MDB_COMM_COMMON
USB GND != DEX_ISO_GND
```

Provide separate machine-side and logic-side test-point groups. Do not label a machine-side reference merely `GND`; use explicit names to prevent technicians from clipping a grounded scope probe to the wrong domain.

Recommended logic test points:

- `TP_ISO5`
- `TP_3V3`
- `TP_LOGIC_GND`
- `TP_GPIO4_MDB_TX_MON`
- `TP_GPIO5_MDB_RX_MON`
- `TP_GPIO17_DEX_RX`
- `TP_GPIO18_DEX_TX`

Recommended machine-side test points:

- `TP_MACH_34V`
- `TP_MACH_PWR_RETURN`
- `TP_MDB_COMM_COMMON`
- `TP_MDB_PIN4_RAW`
- `TP_MDB_PIN5_RAW`
- `TP_DEX_ISO_GND`

---

## 9. PCB isolation/layout requirements

The CAD schematic and PCB must make the domain split visually and electrically obvious.

- Keep a defined isolation corridor under/across PS1 and every signal isolator.
- No copper pours, stitching vias or test pads may bridge that corridor.
- Do not route antenna/RF traces through or parallel to noisy DC/DC switch-current loops.
- Keep the Air780 bulk capacitance and power loop short and wide on the isolated logic side.
- Keep raw MDB and DEX traces on the machine side away from ESP32 antenna keep-out areas.
- Use component manufacturer creepage/clearance recommendations and the intended pollution/working-voltage environment; do not reduce spacing merely to hit 30 x 30 mm.
- Clearly mark `MACHINE SIDE` and `ISOLATED LOGIC SIDE` on silkscreen.
- Mark J1 pin 1 and connector orientation unambiguously on silkscreen and assembly drawing.

---

## 10. Schematic freeze matrix

| Block | State | Notes |
|---|---|---|
| MDB connector pinout | locked | standard 6-pin functional mapping |
| Firmware GPIO assignment | locked | GPIO1/2, 4/5, 17/18 |
| Main isolation topology | locked | machine rail -> isolated DC/DC -> logic |
| PS1 electrical envelope | locked | 18–75 V input, 5 V >=3 A, >=15 W, >=1.5 kV isolation |
| PS1 exact part | candidate | UEI15-050-Q48N-C |
| Input protection topology | locked | fuse/current protection + reverse + transient + filter |
| Input protection values | validation | freeze after inrush/transient measurements |
| DEX isolation topology | locked | ADM3251E-class isolated RS-232 |
| DEX 3.3->5 V translator | candidate locked for validation | SN74AHCT1G125 |
| DEX 5->3.3 V translator | candidate locked for validation | SN74LVC1G17 |
| MDB channel A sensing | validation | passive loading/timing measurement required |
| MDB channel B sensing | validation | passive loading/timing measurement required |
| USB domain separation | locked | USB/logic only |
| 30 x 30 mm board outline | not locked | unsafe to force before validated layout |

---

## 11. CAD release condition

The next CAD artifact may be called **Rev-B EVT schematic** only after:

1. the DEX logic translation is included;
2. the selected PS1 footprint and pinout are verified against its current datasheet;
3. an input protection calculation is attached;
4. the MDB passive receiver topology has either a proven reference design or bench-derived input/loading targets;
5. ERC shows no direct connection between any MACHINE-domain reference and `LOGIC_GND` / `USB_GND`.

Gerber generation comes after schematic review, PCB layout, DRC and the release-gate checks. This document alone is not a manufacturing package.
