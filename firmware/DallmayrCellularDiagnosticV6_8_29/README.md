# Air780EU Cellular Diagnostic V6.8.29

This sketch isolates the Air780EU/Vodacom data path from the Dallmayr production telemetry firmware.

## Why this exists

V6.8.28 proved:

- LTE registration works.
- Vodacom signal is strong.
- The modem accepts `ATD*99#` and returns `CONNECT`.
- LCP succeeds.
- PAP blank/blank advances to IPCP.
- The remaining failure is during IPv4 IPCP negotiation.

This diagnostic removes MDB, DEX, Wi-Fi, Supabase authentication, NVS enrollment, background retries, USSD and all other application work.

## Wiring

- Air780EU TX -> ESP32-S3 GPIO1
- Air780EU RX <- ESP32-S3 GPIO2
- Air780EU powered from a stable external 5 V supply
- Logic grounds common

## Test procedure

1. Flash `DallmayrCellularDiagnosticV6_8_29.ino`.
2. Do not erase the Air780EU or change its firmware.
3. Open Serial Monitor at 115200.
4. Reset the ESP32 once.
5. Do not send commands while the test is running.
6. Let the one PPP attempt run for the full 120 seconds if necessary.
7. Copy the complete output from `=== PDP / APN BASELINE ===` through `=== DIAGNOSTIC COMPLETE ===`.

The sketch intentionally does not retry. Reset the ESP32 to run another clean attempt.

## What it traces

The sketch prints both directions of:

- LCP
- PAP
- IPCP
- CCP

For IPCP it decodes:

- IP address
- VJ compression option
- primary DNS
- secondary DNS
- Configure-Request
- Configure-Ack
- Configure-Nak
- Configure-Reject

This makes it possible to see exactly which IPCP option is preventing the link reaching RUNNING.

## PPP profile

The sketch mirrors the relevant OpenLuat Linux PPP reference behaviour:

- PAP blank username / blank password
- accept peer-selected local IP
- accept peer-selected remote IP
- request dynamic IP
- peer DNS
- VJ disabled
- VJ connection-ID compression disabled
- CCP compression options disabled
- no automatic retry loop

The test allows 120 seconds for IPCP. The production firmware previously aborted after 30 seconds while still in NETWORK/IPCP.

## Success criteria

A working PPP link should show:

```text
[PPP PHASE] NETWORK/IPCP
[PPP PHASE] RUNNING
[PPP STATUS] UP local=...
[PASS] PPP reached RUNNING.
```

It then automatically tests:

1. DNS resolution of the Supabase host
2. TCP port 443
3. ESP32 TLS handshake
4. a simple HTTPS HEAD request

Expected final result:

```text
[DNS PASS] ...
[TCP PASS] Port 443 connected.
[TLS PASS] ESP32 TLS handshake succeeded.
```

## Independent Windows modem test

For a second isolation test, connect the Air780EU directly to the Windows PC by USB-C.

OpenLuat's Windows PPP procedure is:

1. Open **Control Panel -> Phone and Modem**.
2. Add a **Standard 33600 bps Modem** on the Air780EU modem/AT COM port.
3. Open **Network and Sharing Center -> Set up a new connection or network -> Dial-up**.
4. Use dial number **99**1#** as documented by OpenLuat for Windows PPP.
5. Leave credentials blank unless Windows explicitly requires values.
6. Connect and test internet access.

If Windows PPP succeeds but the ESP32 diagnostic does not, the remaining problem is the ESP32/lwIP configuration. If Windows PPP also fails, stop changing ESP32 telemetry code and investigate Air780EU V1180 modem firmware/carrier interaction.
