# MDB-SENSE-EVT-A — isolated sensing daughterboard

Status: **bench/simulator validation fixture only**

Purpose: validate the Rev-B MDB receive front end independently from the full telemetry PCB before committing the ESP32/Air780/DEX carrier to manufacturing.

This daughterboard is receive-only. It contains no MDB power-input path and no device capable of actively driving either MDB communications line.

## 1. External connectors

### J_MDB_TEST — simulator/MDB communications side

Three positions only:

1. `MDB_MASTER_TX_RAW` — corresponds to MDB pin 5 / VMC Master Transmit observation.
2. `MDB_MASTER_RX_RAW` — corresponds to MDB pin 4 / VMC Master Receive observation.
3. `MDB_COMM_COMMON` — corresponds to MDB pin 6 / Communications Common.

**MDB pins 1 (+34 V), 2 (Power Return) and 3 (N/C) do not exist on this daughterboard connector.**

This prevents the validation fixture from being mistaken for the main telemetry power interface.

### J_LOGIC_TEST — ESP32/logic side

Five positions:

1. `ISO_5V_IN` — regulated 5 V from the logic-side bench supply / ESP32 carrier supply.
2. `LOGIC_GND` — logic-side return.
3. `3V3_LOGIC_IN` — regulated 3.3 V for ISO7720 side 2.
4. `MDB_TX_MON_3V3` — isolated logic output to ESP32 GPIO4 or logic analyser.
5. `MDB_RX_MON_3V3` — isolated logic output to ESP32 GPIO5 or logic analyser.

Do not connect `LOGIC_GND` to `MDB_COMM_COMMON`.

## 2. Isolation architecture

```text
LOGIC SIDE                              MDB SENSE SIDE

ISO_5V_IN ----+                  +---- MDB_SENSE_5V
              |    NXF1S0505MC   |
LOGIC_GND ----+----[ 3kV DC ]----+---- MDB_COMM_COMMON

3V3_LOGIC_IN --+                 +-- MDB_SENSE_5V
LOGIC_GND -----|--- ISO7720 -----|-- MDB_COMM_COMMON
GPIO4 output <-|                 |<- comparator TX output
GPIO5 output <-+                 +<- comparator RX output
```

No copper crosses either isolation barrier except through the rated isolated devices.

## 3. Comparator network

Candidate comparator: `TLV3202-Q1`, powered from `MDB_SENSE_5V`, referenced to `MDB_COMM_COMMON`.

### Master-TX channel

```text
MDB_MASTER_TX_RAW
    |
   100k R_TX_SER
    |
MDB_TX_SENSE_NODE ------> U_MDB_CMP INA+
    |       |
  10pF     2.2M R_HYS_A
  DNI       |
    |       +------------- U_MDB_CMP OUTA
MDB_COMM_COMMON

MDB_THRESHOLD_REF ------> U_MDB_CMP INA-
```

### Master-RX channel

Same candidate network using `R_RX_SER = 100k`, `R_HYS_B = 2.2M`, optional 10 pF DNI footprint and comparator channel B.

### Reference

```text
MDB_SENSE_5V -- 100k --+-- 100k -- MDB_COMM_COMMON
                       |
                MDB_THRESHOLD_REF
                       |
                     10nF
                       |
                MDB_COMM_COMMON
```

Nominal calculated switching band at 5.0 V sensing supply is approximately 2.386 V / 2.614 V with approximately 227 mV hysteresis. These are bench-only candidate values.

## 4. Raw-line protection footprints

Provide unpopulated/DNI footprints between each raw communications input and the isolated sensing reference so low-leakage, low-capacitance protection can be added after the simulator/transient measurements.

Initial assembly:

- `D_TX_PROTECT`: DNI
- `D_RX_PROTECT`: DNI
- `C_TX_IN`: DNI
- `C_RX_IN`: DNI

Do not substitute generic TVS or zener parts during assembly. Their leakage and capacitance are part of the validation target.

## 5. Test points

Machine/sense side:

- `TP_TX_RAW`
- `TP_RX_RAW`
- `TP_MDB_COMMON`
- `TP_MDB_SENSE_5V`
- `TP_TX_SENSE_NODE`
- `TP_RX_SENSE_NODE`
- `TP_THRESHOLD_REF`
- `TP_CMP_TX_OUT`
- `TP_CMP_RX_OUT`

Logic side:

- `TP_ISO_5V_IN`
- `TP_3V3_LOGIC`
- `TP_LOGIC_GND`
- `TP_GPIO4_OUT`
- `TP_GPIO5_OUT`

Keep machine/sense-side and logic-side test points in visibly separate silkscreen regions.

## 6. Assembly state

Populate:

- NXF1S0505MC isolated 5 V / 5 V supply
- TLV3202-Q1 dual comparator
- ISO7720 dual digital isolator
- 100 kΩ TX/RX series resistors
- 100 kΩ / 100 kΩ reference divider
- 2.2 MΩ feedback resistors
- 10 nF reference bypass
- local 0.1 µF IC bypass capacitors
- connectors and test points

DNI:

- raw-line protection devices
- 10 pF TX/RX input filter capacitors

## 7. Bench sequence

This fixture is for an MDB simulator / isolated bench source first, not a live vending machine.

1. With no MDB/simulator connection, power J_LOGIC_TEST from a current-limited logic-side supply.
2. Verify `MDB_SENSE_5V` is regulated and remains isolated from `LOGIC_GND`.
3. Drive each raw input from an isolated 0–5 V bench stimulus referenced to `MDB_COMM_COMMON` and verify switching thresholds/hysteresis.
4. Verify `MDB_TX_MON_3V3` and `MDB_RX_MON_3V3` are valid 3.3 V logic and preserve timing.
5. Move to a proper MDB simulator/known-good controller and perform the loading/timing/10,000-frame matrix.
6. Only after those gates pass may the same front-end values be considered for the complete Rev-B EVT PCB.

Do not bypass an RCD, earth connection, isolation barrier or protective device for this test.

## 8. Acceptance before integration into full PCB

- no continuity `MDB_COMM_COMMON` → `LOGIC_GND`;
- no continuity `MDB_COMM_COMMON` → USB ground;
- `MDB_SENSE_5V` within candidate component limits;
- switching band measured with useful active/inactive margin;
- <=50 µA added-line-loading design target met on both channels;
- <=5 µs raw-to-GPIO propagation target met;
- zero hardware-induced framing/checksum errors over 10,000 simulator frames;
- no disruption of existing MDB peripheral traffic;
- optional capacitors/protection parts remain DNI unless measurements justify them.

This validation fixture does not change `field_use_allowed` or `manufacturing_release_allowed`; both remain false for Rev-B until the full release-gate sequence passes.
