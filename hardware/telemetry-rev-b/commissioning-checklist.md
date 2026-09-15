# Rev-B electrical commissioning checklist

This checklist must be completed before any Rev-B telemetry board is connected to a live vending machine.

## 1. Unpowered assembly inspection

- [ ] Verify PCB revision and assembly BOM match the reviewed Rev-B release.
- [ ] Confirm MDB connector orientation and pin numbering from the physical connector drawing, not wire colour.
- [ ] Confirm MDB pin 1 routes only to the protected power-input chain.
- [ ] Confirm MDB pin 2 routes only to the MACHINE-side power-return network.
- [ ] Confirm MDB pin 3 is N/C.
- [ ] Confirm MDB pin 4 routes only to the MACHINE-side passive Master-RX sensing network.
- [ ] Confirm MDB pin 5 routes only to the MACHINE-side passive Master-TX sensing network.
- [ ] Confirm MDB pin 6 routes only to the MACHINE-side communications reference.
- [ ] Confirm DEX machine common remains on the isolated DEX side.
- [ ] Confirm ADM3251E-class 5 V logic is not wired directly to ESP32 GPIO17/GPIO18.
- [ ] Confirm the 3.3 V -> 5 V and 5 V -> 3.3 V DEX translator devices match the reviewed schematic/BOM.
- [ ] Inspect the isolation barrier for solder bridges, copper pours, vias or component bodies that violate the intended separation.

## 2. Continuity / isolation checks — board unpowered

Use a DMM first. Escalate to insulation testing only with equipment and procedures appropriate for the populated electronics.

Required DMM results:

- [ ] `MACH_PWR_RETURN` to `LOGIC_GND`: no continuity.
- [ ] `MACH_PWR_RETURN` to `USB_GND`: no continuity.
- [ ] `MDB_COMM_COMMON` to `LOGIC_GND`: no continuity.
- [ ] `MDB_COMM_COMMON` to `USB_GND`: no continuity.
- [ ] `DEX_RS232_COMMON` to `LOGIC_GND`: no continuity.
- [ ] `DEX_RS232_COMMON` to `USB_GND`: no continuity.
- [ ] `DEX_ISO_GND` to `LOGIC_GND`: no continuity.
- [ ] `DEX_ISO_GND` to `USB_GND`: no continuity.
- [ ] MDB pin 4 raw to ESP32 GPIO5: no direct continuity.
- [ ] MDB pin 5 raw to ESP32 GPIO4: no direct continuity.
- [ ] USB shield/ground to machine-side test points: no unintended low-resistance path.

Record measured resistance values rather than writing only “pass”.

## 3. Current-limited bench power

Do not begin on a vending machine. Use a current-limited bench supply feeding the Rev-B MDB power input.

At each voltage point, record input current, isolated 5 V output, 3.3 V output, board temperature and whether the ESP32/modem reset.

- [ ] 20 VDC input test.
- [ ] 34 VDC input test.
- [ ] 42.5 VDC input test.
- [ ] Controlled high-line/transient test designed from the selected converter/protection datasheets; do not improvise a destructive surge test.

Acceptance:

- ISO_5V remains inside the power-system tolerance defined by the selected modem/carrier.
- 3V3_LOGIC remains stable.
- No component exceeds its reviewed thermal limit.
- No protective device conducts continuously during the valid MDB operating range.

## 4. Cellular worst-case load test

- [ ] Register Air780EU on Vodacom.
- [ ] Establish PPP.
- [ ] Run repeated HTTPS uploads to Supabase.
- [ ] Observe ISO_5V with an oscilloscope during modem transmit bursts.
- [ ] Confirm no brownout, ESP32 reset, PPP drop or converter current-limit event.
- [ ] Repeat with Wi-Fi active to cover combined radio loading.

If 5 V droop is excessive, increase converter power margin and/or modem-side bulk capacitance only within the converter and modem manufacturers’ stability/inrush limits.

## 5. MDB isolated-receiver validation

Use an MDB simulator or a known-good bench controller before a customer machine.

- [ ] Verify the board never drives MDB pin 4 or pin 5.
- [ ] Measure MDB idle current/voltage before attaching Rev-B.
- [ ] Attach Rev-B and repeat the idle measurement; record the delta.
- [ ] Verify active waveform levels/timing are not materially changed by either sensing channel.
- [ ] Verify GPIO4 reproduces Master-TX traffic through the isolation path.
- [ ] Verify GPIO5 reproduces Master-RX traffic through the isolation path.
- [ ] Verify normal and inverted polarity settings still work in V6.8.49 or later.
- [ ] Verify 9-bit frames/checksums decode correctly.
- [ ] Verify Learn Mode observations reach DallmayrERP.
- [ ] Verify attaching the telemetry board does not change MDB bus voltage/current outside the simulator/controller acceptance limits.

Do not lock the MDB sensing resistor/threshold values until these measurements pass for both directions independently.

## 6. DEX isolated-interface validation

### Logic-side translation

- [ ] Power `ISO_5V` and `3V3_LOGIC` from the reviewed Rev-B supply paths.
- [ ] Drive ESP32 GPIO18 low/high and measure the SN74AHCT1G125 output into the isolated RS-232 transmitter logic input.
- [ ] Confirm a GPIO18 high produces a valid near-5 V logic high and a low remains within the isolated transceiver low threshold.
- [ ] Stimulate the isolated transceiver receiver and measure its approximately 5 V logic output before the down-translator.
- [ ] Confirm the SN74LVC1G17 output presented to GPIO17 never exceeds the 3.3 V logic rail beyond normal device tolerances.
- [ ] Confirm no translator is being back-powered when either 3V3_LOGIC or ISO_5V is absent.

### RS-232 / isolation path

- [ ] Verify DEX machine-side levels at the isolated transceiver input/output.
- [ ] Verify ESP32 GPIO17 receives DEX data at 9600 baud.
- [ ] Verify GPIO18 transmit is only enabled when the DEX protocol implementation requires it.
- [ ] Verify `DEX_ISO_GND` / machine-side DEX common remains isolated from LOGIC_GND and USB_GND.
- [ ] Verify DEX identity/audit parsing in firmware.

## 7. USB / earth-path validation

This is the critical regression test after the XS Grande RCD event.

With the Rev-B board powered from the bench MACHINE-side input:

- [ ] Connect a laptop by USB.
- [ ] Confirm no measurable DC continuity appears between laptop/USB ground and `MACH_PWR_RETURN`.
- [ ] Confirm no measurable DC continuity appears between laptop/USB ground and `MDB_COMM_COMMON`.
- [ ] Confirm no measurable DC continuity appears between laptop/USB ground and `DEX_ISO_GND`.
- [ ] Repeat with the intended USB charger/service supply.
- [ ] If an oscilloscope is used, use an isolation-safe measurement method appropriate to the circuit; never rely on a grounded probe clip across the isolation barrier.

## 8. Controlled field trial

Only after sections 1–7 pass:

- [ ] Qualified technician verifies the target machine has no existing earth-leakage fault.
- [ ] Confirm the machine can complete the target drink/vend cycle without telemetry connected.
- [ ] Power down and connect Rev-B.
- [ ] Power machine and observe idle operation.
- [ ] Confirm telemetry device is online.
- [ ] Run one controlled vend.
- [ ] Confirm no RCD/earth-leakage trip.
- [ ] Confirm MDB/DEX observation and vend mapping in DallmayrERP.
- [ ] Repeat several cycles before declaring the machine profile compatible.

## Release record

For each prototype, record:

- PCB serial/revision
- assembler/date
- isolated DC/DC manufacturer/part/lot
- DEX isolator manufacturer/part/lot
- DEX up/down translator manufacturer/part/lot
- measured continuity/isolation values
- 20/34/42.5 V test results
- cellular load-test result
- MDB pre/post-attachment loading measurements
- MDB simulator result
- DEX logic-level test result
- DEX end-to-end result
- USB isolation result
- technician name/date for first live-machine trial

A board with incomplete records is not field-approved.