# Dallmayr Telemetry Rev-B — isolated MDB monitor integration

Status: **EVT candidate architecture / bench validation required**

This document converts the MDB electrical limits into a receive-only sensing architecture suitable for Rev-B telemetry. It does **not** authorise connection to a live machine yet.

## 1. MDB electrical limits used as design inputs

The MDB/ICP hardware specification defines a 5 V optically isolated current-loop interface.

Relevant limits:

- VMC Master Transmit: minimum source current 100 mA at 4 V active; maximum leakage 100 uA inactive.
- VMC Master Receive: minimum input current 15 mA at 1 V active; maximum input current 1 mA inactive.
- Peripheral Receive: maximum input current 15 mA at 4 V active; maximum input current 100 uA inactive.
- Peripheral Transmit: minimum sink current 15 mA at 1 V active; maximum leakage 30 uA inactive.
- Bus rate: 9600 baud, nominal bit time approximately 104.167 us.

The telemetry unit is not an MDB peripheral and must not consume a normal peripheral current budget merely to observe traffic. Rev-B therefore targets <=50 uA additional loading on either communications line across the normal signal range.

## 2. Why the old direct/opto tap is rejected

A simple optocoupler LED plus resistor can require milliamp-class line current. That can:

- add meaningful load to Master Transmit;
- disturb the voltage/current relationship seen by existing peripherals;
- alter Master Receive idle current;
- change edge timing;
- conceal wiring mistakes by still producing a logic transition.

Rev-B instead uses a powered, high-input-impedance comparator on a separately isolated MDB sensing domain.

## 3. MDB isolated sensing power domain

Candidate: **Murata NXF1S0505MC**.

```text
ISO_5V / LOGIC_GND
        |
        | primary
      PS_MDB
        | 3 kVDC isolation
        | secondary
MDB_SENSE_5V / MDB_COMM_COMMON
```

Rules:

- PS_MDB input is in the LOGIC domain.
- PS_MDB output negative is tied only to `MDB_COMM_COMMON`.
- `MDB_COMM_COMMON` remains isolated from `LOGIC_GND`, `USB_GND`, and `MACH_PWR_RETURN`.
- `MDB_SENSE_5V` powers only the MDB comparator/isolator machine-side circuitry.
- The candidate is regulated so low sensing-domain load cannot raise the rail beyond the comparator supply rating.

## 4. Comparator stage

Candidate: **TI TLV3202-Q1**, dual push-pull comparator.

Useful characteristics for this application:

- 2.7 V to 5.5 V supply;
- rail-to-rail input range extending slightly beyond the rails;
- typical 40 ns propagation;
- maximum input bias current 0.05 nA;
- two channels in one package.

Both channels are powered from `MDB_SENSE_5V` and referenced to `MDB_COMM_COMMON`.

### Channel A — Master Transmit, J1 pin 5

```text
MDB_MASTER_TX_RAW
  -> high-value protected divider / input-current limiter
  -> comparator A
  -> MDB_TX_SENSE_LOGIC
```

### Channel B — Master Receive, J1 pin 4

```text
MDB_MASTER_RX_RAW
  -> independent high-value protected divider / input-current limiter
  -> comparator B
  -> MDB_RX_SENSE_LOGIC
```

The channel input networks are intentionally independent. Do not assume identical threshold polarity or filtering until oscilloscope measurements confirm both waveforms.

## 5. Threshold and hysteresis design targets

Initial EVT targets, not frozen resistor values:

- total additional steady-state line current from the sensing input: <=50 uA over the normal MDB communications voltage range;
- nominal raw decision threshold: between 2.0 V and 3.0 V;
- raw-line hysteresis: 100 mV to 400 mV;
- no clamp/protection conduction during valid normal communications levels;
- raw-line threshold must retain margin to both measured active and inactive levels on every tested machine/controller.

The final divider, threshold and hysteresis resistors are selected only after baseline bus captures are recorded.

## 6. Protection rules

Each raw communications input may contain:

- a high-value series resistor or split resistor string;
- low-capacitance protection compatible with the measured MDB communications waveform;
- comparator-input clamps only when their normal-current path is proven negligible;
- optional small RC filtering after calculating its edge delay.

Prohibited:

- TVS parts whose capacitance materially degrades a 9600-baud edge;
- a zener/clamp that conducts at normal active levels;
- an LED/opto path whose line current exceeds the validated loading target;
- any transistor, analog switch or open collector that can drive pin 4 or pin 5.

## 7. Digital isolation back to ESP32

Candidate: **TI ISO7720**, configured with both channels from MDB sense domain to logic domain.

```text
MDB_TX_SENSE_LOGIC -> ISO7720 channel A -> MDB_TX_MON_3V3 -> GPIO4
MDB_RX_SENSE_LOGIC -> ISO7720 channel B -> MDB_RX_MON_3V3 -> GPIO5

ISO7720 VCC1 -> MDB_SENSE_5V
ISO7720 GND1 -> MDB_COMM_COMMON
ISO7720 VCC2 -> 3V3_LOGIC
ISO7720 GND2 -> LOGIC_GND
```

Use the package/isolation grade selected during schematic review. No reverse-direction channel is required for MDB Rev-B.

## 8. Polarity handling

Hardware should preserve a stable logic representation; firmware V6.8.49 or later retains automatic/manual polarity handling. Do not add a hardware inversion switch simply to compensate for uncertain wiring.

Channel identity remains fixed:

- GPIO4 = isolated observation of MDB pin 5 / Master Transmit.
- GPIO5 = isolated observation of MDB pin 4 / Master Receive.

If a harness swaps the physical lines, correct the harness or explicit device pin-swap setting; do not redefine connector pin functions.

## 9. Timing acceptance

At 9600 baud, one bit is approximately 104.167 us. The combined comparator, isolator, protection and RC network must target <=5 us from raw threshold crossing to ESP32 GPIO transition.

Bench validation must record:

- propagation delay for rising and falling transitions;
- pulse-width distortion;
- difference between the two channels;
- decode result using the production ESP32 RMT path.

The target is deliberately much slower than the semiconductor propagation delay because passive input filtering/protection is expected to dominate.

## 10. Loading validation method

For each channel and each tested controller/machine:

1. capture raw idle/active waveform with telemetry disconnected;
2. record line voltage and source/sink current where safely measurable with appropriate bench equipment;
3. attach only the MDB sensing front end;
4. capture the same measurements;
5. calculate delta loading and waveform shift;
6. reject the front end if additional loading exceeds 50 uA design target or creates a material edge/level change;
7. run at least 10,000 known frames through the production decoder and require zero hardware-induced checksum/framing errors;
8. verify existing MDB peripherals continue normal operation.

The 50 uA figure is a conservative Rev-B design target, not a claim that MDB itself requires a 50 uA observer.

## 11. Release conditions for the MDB section

The MDB input resistor networks may move from `validation` to `candidate_locked_for_evt` only when all are true:

- both channels meet <=50 uA added-load target;
- measured active/inactive levels have threshold margin on the tested controller set;
- propagation target is met;
- 10,000-frame replay/simulator test passes with zero hardware-induced errors;
- existing peripheral traffic is unchanged;
- no continuity exists from `MDB_COMM_COMMON` to `LOGIC_GND`, `USB_GND`, or `MACH_PWR_RETURN`;
- USB-connected debugging does not create a machine-side DC path.

Until then, manufacturing and field-use flags remain false.
