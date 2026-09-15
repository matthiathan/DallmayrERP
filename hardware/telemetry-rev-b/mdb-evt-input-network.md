# Dallmayr Telemetry Rev-B — MDB EVT input-network population

Status: **bench-only EVT candidate; not production-locked**

This document gives the first populated values for the Rev-B MDB passive monitor so an EVT board can be built and measured. These values are deliberately marked as validation candidates. They must not be promoted to production until the loading, threshold, timing and 10,000-frame gates in `mdb-validation-matrix.csv` pass.

## 1. Candidate topology per channel

Each raw MDB communications line is sensed by one TLV3202-Q1 comparator channel on the isolated `MDB_SENSE_5V / MDB_COMM_COMMON` domain.

```text
                         2.2 MΩ feedback
                    +-----------------------+
                    |                       |
MDB_RAW --- 100 kΩ -+---- SENSE_NODE ---- comparator signal input
                    |                       |
                    +-- 10 pF footprint ----+-- MDB_COMM_COMMON
                        default DNI

MDB_SENSE_5V --- 100 kΩ ---+--- 100 kΩ --- MDB_COMM_COMMON
                            |
                     MDB_THRESHOLD_REF
                            |
                          10 nF
                            |
                    MDB_COMM_COMMON

Comparator reference input <- MDB_THRESHOLD_REF
Comparator output          -> feedback resistor and ISO7720 input
```

The 10 pF raw-input capacitor is a tuning footprint and is **DNI by default** on the first power-up. It may be populated only after oscilloscope captures show that additional filtering is useful and the propagation/pulse-width targets remain satisfied.

## 2. Candidate values

Use the following initial population on both channels:

| Function | EVT value | Production status |
|---|---:|---|
| Raw-line series resistor | 100 kΩ | validation candidate |
| Reference divider top | 100 kΩ | validation candidate |
| Reference divider bottom | 100 kΩ | validation candidate |
| Positive-feedback resistor | 2.2 MΩ | validation candidate |
| Raw-input capacitor footprint | 10 pF | DNI by default |
| Reference bypass capacitor | 10 nF | validation candidate |
| Comparator local bypass | 0.1 µF | required |
| ISO7720 side-1 bypass | 0.1 µF | required |
| ISO7720 side-2 bypass | 0.1 µF | required |

Use resistor packages/voltage ratings appropriate to the measured raw-line transient environment. The 100 kΩ series function may be split across two footprints later if transient-energy/creepage analysis requires it.

## 3. Nominal switching calculation

Let:

- `VCC = 5.0 V`
- `VREF = 2.5 V` from the 100 kΩ / 100 kΩ reference divider
- `RS = 100 kΩ`
- `RF = 2.2 MΩ`
- `k = RS / RF = 0.0454545`

At the switching point the comparator signal node equals `VREF`. KCL gives the raw-line switching voltage:

```text
VRAW = VREF * (1 + k) - VOUT * k
```

For the two output states:

```text
VOUT = 5 V -> VRAW ≈ 2.386 V
VOUT = 0 V -> VRAW ≈ 2.614 V
```

So the nominal raw-line hysteresis band is approximately:

```text
2.386 V to 2.614 V
width ≈ 0.227 V (227 mV)
```

This is inside the Rev-B target window of 2.0–3.0 V with 100–400 mV hysteresis.

## 4. Sense-rail tolerance check

Using the same resistor ratios:

| MDB_SENSE_5V | Lower threshold | Upper threshold |
|---:|---:|---:|
| 4.9 V | ≈2.339 V | ≈2.561 V |
| 5.0 V | ≈2.386 V | ≈2.614 V |
| 5.1 V | ≈2.434 V | ≈2.666 V |

This table is a nominal resistor calculation only. Comparator offset, resistor tolerance, rail accuracy, line leakage and protection leakage must be included in the measured EVT threshold margin.

## 5. Loading behaviour

This network is intentionally **not** a conventional raw-line-to-ground divider.

The 100 kΩ resistor feeds the high-impedance comparator signal node. The 2.2 MΩ resistor returns comparator output feedback to the same node. In a stable rail-like state the comparator output follows the raw state, so the DC potential difference across the 100 kΩ path is small.

Examples using ideal 0 V / 5 V comparator output:

- raw line 5 V, output 5 V: approximately zero ideal divider current;
- raw line 0 V, output 0 V: approximately zero ideal divider current;
- raw line 4 V, output 5 V: ideal line current is roughly 0.4–0.5 µA;
- raw line 1 V, output 0 V: ideal line current is roughly 0.4–0.5 µA.

Real loading also includes comparator bias, PCB contamination/leakage, protection-device leakage and measurement fixtures. Therefore the acceptance requirement remains **<=50 µA additional line loading**, measured before/after on the simulator/controller. Do not infer compliance solely from the resistor calculation.

## 6. Optional RC calculation

If the 10 pF tuning capacitor is populated:

```text
100 kΩ × 10 pF = 1.0 µs nominal RC time constant
```

MDB at 9600 baud has a nominal bit time of approximately 104.167 µs. A 1 µs first-order input time constant is therefore small relative to one bit, but the actual raw-to-GPIO delay and pulse-width distortion must still be measured. The hardware target remains <=5 µs total raw-threshold-crossing to ESP32 GPIO transition.

Default EVT assembly rule: **C_MDB_TX_IN and C_MDB_RX_IN are DNI** until unfiltered captures are taken.

## 7. Comparator polarity

Initial schematic intent:

- signal node to comparator non-inverting input;
- `MDB_THRESHOLD_REF` to comparator inverting input;
- output high when the measured raw-line voltage is above the upper threshold;
- output low when below the lower threshold.

Firmware already supports electrical inversion/polarity handling. Hardware must not add a bidirectional or drive-capable polarity circuit.

If bench captures show that either MDB line uses a materially different amplitude convention, adjust that channel's passive threshold network rather than redefining the MDB connector pins.

## 8. Raw-line protection — intentionally not populated yet

The EVT schematic must provide footprints for low-leakage / low-capacitance protection, but the first candidate values remain `DNI/TBD` until raw transients are measured.

Protection acceptance rules:

- normal valid MDB communication must not forward-bias/clamp the protection network;
- total additional line loading, including protection leakage, must stay <=50 µA design target;
- capacitance must not cause timing/decode failure;
- transient ratings must be based on measured or defensible source/transient data;
- no protection component may create a path to `LOGIC_GND`, `USB_GND` or `MACH_PWR_RETURN`.

## 9. What is frozen and what is not

Frozen for the first EVT schematic:

- isolated `MDB_SENSE_5V` domain;
- TLV3202-Q1 comparator candidate;
- ISO7720 machine-to-logic isolation candidate;
- 100 kΩ raw series footprint/value candidate;
- 100 kΩ / 100 kΩ reference-divider candidate;
- 2.2 MΩ feedback candidate;
- 10 pF raw-filter footprints, default DNI;
- 10 nF reference bypass candidate;
- GPIO4 = Master-TX observation, GPIO5 = Master-RX observation;
- no active MDB transmit path.

Not production-frozen:

- any of the above resistor/capacitor values;
- comparator polarity if measurements reveal an unexpected raw convention;
- line protection/clamp component part numbers;
- optional RC population;
- final PCB outline.

The values may be promoted only after the full MDB validation matrix passes and the safety contract is explicitly advanced in a later reviewed change.
