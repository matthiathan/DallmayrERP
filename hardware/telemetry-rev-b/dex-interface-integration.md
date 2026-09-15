# Rev-B DEX integration — ADM3251E validation candidate

Status: **CAD input for EVT / candidate part, not production locked**

This file converts the current Analog Devices ADM3251E datasheet into explicit Rev-B schematic inputs and includes the required 3.3 V / 5 V logic translation.

## Why level translation is mandatory

ADM3251E is powered from 5 V on its logic side. At that supply its transmitter logic input is not guaranteed to recognise every 3.3 V CMOS high directly, while `ROUT` can rise close to the 5 V supply. Therefore neither logic signal is wired directly to ESP32-S3 GPIO.

Rev-B uses fixed-direction translators:

```text
ESP32 GPIO18 (3.3V TX)
 -> SN74AHCT1G125 powered from ISO_5V
 -> ADM3251E TIN

ADM3251E ROUT (5V logic)
 -> SN74LVC1G17 powered from 3V3_LOGIC
 -> ESP32 GPIO17 (3.3V RX)
```

## ADM3251E pin map

20-lead wide SOIC, top-view numbering per the current Analog Devices datasheet.

| Pin | Mnemonic | Rev-B connection |
|---:|---|---|
| 1 | NC | leave unconnected |
| 2 | VCC | `ISO_5V` |
| 3 | VCC | `ISO_5V`; place logic-side bypass close to pins 3/4 |
| 4 | GND | `LOGIC_GND` |
| 5 | GND | `LOGIC_GND` |
| 6 | GND | `LOGIC_GND` |
| 7 | GND | `LOGIC_GND` |
| 8 | ROUT | `DEX_RX_5V` -> U_DEX_DOWN input |
| 9 | TIN | `DEX_TX_5V` <- U_DEX_UP output |
| 10 | GND | `LOGIC_GND` |
| 11 | GNDISO | `DEX_ISO_GND` |
| 12 | V- | charge-pump reservoir only; C4 to `DEX_ISO_GND` |
| 13 | C2- | C2 negative terminal |
| 14 | C2+ | C2 positive terminal |
| 15 | RIN | `DEX_RS232_RX_MACHINE` |
| 16 | TOUT | `DEX_RS232_TX_MACHINE` |
| 17 | C1- | C1 negative terminal |
| 18 | C1+ | C1 positive terminal |
| 19 | V+ | charge-pump positive reservoir; C3 to `VISO` |
| 20 | VISO | internally generated isolated supply; decouple to `DEX_ISO_GND`, do not use to power other circuitry |

## Required capacitor network

Use the current datasheet typical operating circuit with the internal isolated DC/DC enabled (`VCC = 4.5–5.5 V`).

### Logic-side bypass

- `C_DEX_VCC`: 0.1 uF ceramic from `ISO_5V` to `LOGIC_GND`, located close to ADM3251E VCC/GND pins.

### Isolated-side bypass

- `C_DEX_VISO`: 0.1 uF ceramic from pin 20 `VISO` to pin 11 `DEX_ISO_GND`, close to the device.

### Charge pump

- `C1`: 0.1 uF, >=16 V, between pin 18 `C1+` and pin 17 `C1-`.
- `C2`: 0.1 uF, >=16 V, between pin 14 `C2+` and pin 13 `C2-`.
- `C3`: 0.1 uF, >=10 V, between pin 19 `V+` and pin 20 `VISO` (the datasheet notes V+ to GNDISO is also electrically effective, but Rev-B follows the typical circuit).
- `C4`: 0.1 uF, >=16 V, between pin 12 `V-` and pin 11 `DEX_ISO_GND`.

Do not hang external loads from VISO when the ADM3251E internal DC/DC is enabled.

## U_DEX_UP — ESP32 3.3 V to ADM3251E 5 V

Validation candidate: **Texas Instruments SN74AHCT1G125**.

- VCC -> `ISO_5V`
- GND -> `LOGIC_GND`
- `/OE` -> `LOGIC_GND` for always-enabled EVT operation
- A <- `DEX_TX_3V3` / ESP32 GPIO18
- Y -> `DEX_TX_5V` -> ADM3251E pin 9 TIN
- local decoupling capacitor at VCC

AHCT is used intentionally because its TTL-compatible input guarantees high recognition at a much lower threshold than 5 V CMOS logic, so the ESP32 3.3 V output has margin.

Provide a small series-resistor footprint in the GPIO18 path (22–100 ohm tuning range, initial build may use 0–33 ohm after signal review).

## U_DEX_DOWN — ADM3251E 5 V to ESP32 3.3 V

Validation candidate: **Texas Instruments SN74LVC1G17**.

- VCC -> `3V3_LOGIC`
- GND -> `LOGIC_GND`
- A <- `DEX_RX_5V` from ADM3251E pin 8 ROUT
- Y -> `DEX_RX_3V3` -> ESP32 GPIO17
- local decoupling capacitor at VCC

The LVC input is over-voltage tolerant to 5.5 V, while the output high is limited by its 3.3 V VCC, so it provides a clean 5 V-to-3.3 V boundary.

Provide a small series-resistor footprint in the GPIO17 output path for edge/ringing tuning if required.

## Machine-side DEX connector

At the isolated line side:

```text
ADM3251E pin 16 TOUT -> DEX_RS232_TX_MACHINE -> J_DEX TX
J_DEX RX -> DEX_RS232_RX_MACHINE -> ADM3251E pin 15 RIN
J_DEX signal common -> DEX_ISO_GND -> ADM3251E pin 11 GNDISO
```

Machine/harness pin numbering is model-specific and is not locked by this board document. The DEX harness must have a separate drawing for each physical connector family.

`DEX_ISO_GND` is an isolated RS-232 signal reference. It is not `LOGIC_GND` and must not be tied to USB ground.

## Isolation/layout rules

- Observe the ADM3251E wide-SOIC isolation barrier; no copper or via stitching crosses beneath the defined isolation region except where the device itself bridges it internally.
- Keep `LOGIC_GND` copper on pins 4/5/6/7/10 side separate from `DEX_ISO_GND` copper on pin 11 side.
- Keep VISO/charge-pump loops compact on the isolated side.
- Keep the VCC bypass loop compact on the logic side.
- Follow the current Analog Devices thermal/layout recommendations for the ground pins and device power dissipation.
- Do not use `VISO` to power ESD devices, LEDs or external DEX circuitry when the internal converter is enabled.

## EVT checks before part lock

1. With no machine attached, confirm GPIO18 low/high becomes a valid 0/5 V-class logic waveform at ADM3251E TIN.
2. Confirm ADM3251E ROUT never exposes GPIO17 to the 5 V rail because the signal passes through U_DEX_DOWN.
3. Verify no back-power path when 3V3_LOGIC is absent but ISO_5V is present, and vice versa.
4. Loopback the isolated RS-232 side and confirm sustained 9600-baud traffic with zero framing errors.
5. Confirm `DEX_ISO_GND` remains electrically isolated from `LOGIC_GND` and `USB_GND`.
6. Confirm the machine DEX interface works end-to-end and firmware parsing receives valid identity/audit records.

Only then may the DEX block move from `candidate` to `EVT locked`.