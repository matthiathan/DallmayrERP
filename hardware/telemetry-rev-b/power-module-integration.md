# Rev-B PS1 integration — UEI15-050-Q48N-C validation candidate

Status: **CAD input for EVT / candidate part, not production locked**

This file converts the Murata UEI15-050-Q48N-C datasheet requirements into explicit Rev-B schematic/layout inputs.

Manufacturer family datasheet: Murata UEI15 Series, `MDC_UEI15W`.

## Electrical envelope

- Model: `UEI15-050-Q48N-C`
- Input: 18–75 VDC
- Nominal input family: 48 V
- Output: 5 VDC, 3 A, 15 W
- Isolation: 2250 VDC minimum for Q48 5 V family
- Isolation classification in family datasheet: basic insulation
- Efficiency: approximately 86% at rated conditions
- External input fuse is required; the UEI15-050-Q48 family table recommends **2 A fast-blow**.
- Reverse-polarity protection is **not internal** and remains a required external Rev-B block.

The 2 A fuse recommendation is a converter-family design input, not permission to draw 2 A continuously from a vending-machine MDB rail. The final system fuse/coordination must still be reviewed against the vending-machine source and harness.

## PS1 pin map

Use a six-pin through-hole footprint matching the current Murata mechanical drawing.

| PS1 pin | Function | Rev-B net / treatment |
|---:|---|---|
| 1 | +VIN | `PS1_VIN_PROTECTED` |
| 2 | -VIN | `MACH_PWR_RETURN` |
| 3 | +VOUT | `ISO_5V` |
| 4 | Output Trim | leave open for nominal 5 V unless a reviewed trim network is intentionally fitted |
| 5 | -VOUT | `LOGIC_GND` |
| 6 | Remote On/Off | primary-side control; negative-logic N suffix |

### Pin 6 default for the N suffix

The `N` suffix uses negative logic: the converter is ON when the remote-control pin is at input-side ground and OFF when open/high.

Rev-B EVT default:

```text
PS1 pin 6 REMOTE_ON_OFF
  -> R_PS1_ENABLE, 0 ohm population option
  -> PS1 pin 2 / MACH_PWR_RETURN
```

This makes the converter normally ON without referencing the logic-side ground. Do **not** tie pin 6 to `LOGIC_GND`.

Provide a DNI option/test pad so a future primary-side supervisor can control the pin without PCB surgery.

## Mechanical / isolation placement

Family mechanical envelope is approximately:

- 27.9 mm long
- 24.4 mm wide
- approximately 8.4 mm high for the open-frame family drawing

The Murata family drawing identifies a recommended primary/secondary PCB barrier of approximately **6.3 mm (0.25 in)**. Rev-B layout must preserve at least the manufacturer-recommended barrier around the module footprint unless a formal insulation/creepage calculation requires more.

No ground pour, via stitching, test point or copper fill may cross the PS1 primary/secondary corridor.

Primary-side pins/nets:

- pin 1 `PS1_VIN_PROTECTED`
- pin 2 `MACH_PWR_RETURN`
- pin 6 `PS1_REMOTE_PRIMARY`

Secondary-side pins/nets:

- pin 3 `ISO_5V`
- pin 4 `PS1_TRIM_SECONDARY`
- pin 5 `LOGIC_GND`

## Input chain before PS1

```text
MDB J1 pin 1 / MACH_34V_IN
 -> F1 (2 A fast-blow is the PS1-family recommendation; final part/coordination TBD)
 -> reverse-polarity stage Q_RP
 -> transient clamp D_TVS
 -> input filter network
 -> PS1 pin 1

MDB J1 pin 2 / MACH_PWR_RETURN
 ---------------------------------> PS1 pin 2
```

### F1

CAD requirement:

- provide a replaceable or board-level fast-acting fuse footprint appropriate to the selected assembly process;
- candidate electrical rating: 2 A fast-blow per the UEI15-050-Q48 family recommendation;
- voltage rating must comfortably exceed the MDB rail and expected transient environment;
- final part is not locked until source coordination/inrush review is complete.

### Q_RP

The final reverse-polarity device must:

- survive at least the 75 V converter input envelope with additional engineering margin;
- carry the converter low-line input current without excessive dissipation;
- prevent a reversed MDB harness from applying reverse voltage to PS1;
- not connect any logic-side net to the machine domain.

Exact MOSFET/controller selection remains open.

### D_TVS

The transient clamp remains deliberately unfrozen. A valid candidate must satisfy both:

1. no problematic conduction during the valid ~45 V high-line condition; and
2. actual clamped voltage below the converter absolute input limit at the calculated/measured transient current.

This cannot be chosen correctly from `VRWM` alone. Rev-B must measure/estimate source impedance before locking D_TVS.

## Output side

```text
PS1 pin 3 / ISO_5V
 -> local bulk capacitor bank
 -> Air780E/Air780EU carrier power
 -> ESP32-S3 validation carrier 5 V input
 -> ADM3251E VCC pins
 -> SN74AHCT1G125 VCC

PS1 pin 5 / LOGIC_GND
 -> all LOGIC-domain returns only
```

The modem bulk bank is not a substitute for converter qualification. Its value is chosen after observing `ISO_5V` during worst-case cellular PPP/HTTPS transmit bursts.

## EVT verification before part lock

Record:

- no-load 5 V output at 20, 34 and 42.5 V input;
- input current at those voltages;
- full system current while Air780EU is registered/PPP connected;
- transient `ISO_5V` minimum during cellular upload;
- PS1 case/board temperature under sustained upload;
- cold-start/inrush current;
- behavior of F1 during repeated cold starts;
- continuity showing pin 2/pin 6 primary network remains isolated from pin 5 / `LOGIC_GND`.

Only after those measurements can PS1 move from `candidate` to `EVT locked`.