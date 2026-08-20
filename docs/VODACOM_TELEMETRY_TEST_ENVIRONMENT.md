# Vodacom telemetry test environment

This test proves that an enrolled telemetry device can upload through Vodacom mobile data without adding false production sales. It sends two `simulation_snapshot` payloads; simulation history is stored separately from production reporting.

## Vodacom profile

| Setting | Value |
| --- | --- |
| Carrier | Vodacom South Africa |
| APN | `internet` |
| Username | `guest` |
| Password | blank |
| Authentication | PAP |
| MCC | `655` |
| MNC | `01` |

Use a normal mobile-data, business IoT or M2M SIM. A Vodacom Home Internet SIM may be locked to an approved fixed router and is not suitable for the field telemetry test.

## Safe server test

Set the credentials only in the current terminal. Never commit a device key.

### PowerShell

```powershell
$env:TELEMETRY_TEST_DEVICE_ID="DLM-ESP32-XXXXXXXXXXXX"
$env:TELEMETRY_TEST_DEVICE_KEY="replace-with-the-device-key"
$env:TELEMETRY_TEST_ANON_KEY="replace-with-the-project-anon-jwt"
npm run telemetry:test:vodacom
```

This checks the endpoint, credentials, simulation storage and sales-delta calculation. It does not claim that cellular data was used.

## Conclusive Vodacom test

1. Confirm that the SIM is activated, RICA registered and has data.
2. Connect the cellular antenna before powering the modem.
3. Configure the APN profile above.
4. In Device Management, select **Cellular**, disable **Wi-Fi**, keep **Cellular** enabled, and save.
5. Remove saved Wi-Fi credentials or otherwise ensure there is no Wi-Fi route.
6. Confirm that the modem registered on Vodacom and received an IP address.
7. Route the test computer/device through that Vodacom connection.
8. Run:

```powershell
$env:TELEMETRY_TEST_DEVICE_ID="DLM-ESP32-XXXXXXXXXXXX"
$env:TELEMETRY_TEST_DEVICE_KEY="replace-with-the-device-key"
$env:TELEMETRY_TEST_ANON_KEY="replace-with-the-project-anon-jwt"
$env:TELEMETRY_TEST_TRANSPORT="cellular"
$env:TELEMETRY_TEST_CELLULAR_CONFIRMED="true"
npm run telemetry:test:vodacom
```

The test passes only when both uploads return `accepted: true`, remain in the simulation dataset and calculate a one-item/R15.00 delta.

## Air780E / ESP32-S3 hardware test

Flash `firmware/DallmayrTelemetryV6_1/DallmayrTelemetryV6_1.ino`, open the serial monitor at 115200 baud and run:

```text
SUPABASE ANON KEY <project-anon-jwt>
STATUS
CELL TEST
SIM DATA TEST
DATA USAGE
```

`SIM DATA TEST` bypasses Wi-Fi and calls the ingest endpoint directly through `airHttpPost`. It first uploads a zero-value baseline, then one simulated item worth R15.00 using the same temporary boot ID. The command passes only when the backend reports a delta of exactly one unit and 1,500 cents. It never writes to production sales counters.

The Supabase anon JWT is the project’s public client key, not the service-role key. It keeps gateway JWT verification enabled; the Edge Function then independently verifies the per-device ID and secret. The firmware stores both values in NVS and never prints them.

The firmware stores independent cellular and Wi-Fi JSON-body counters in ESP32 NVS. It reports those cumulative counters with subsequent telemetry so the web app can calculate deltas without double counting after reconnects.

## Firmware data-usage fields

The ingest endpoint always measures telemetry JSON request and response bytes. Firmware V6.1 also reports all application-body traffic handled by the device, including configuration calls:

```json
{
  "data_usage": {
    "counter_epoch": "DEVICE-EPOCH-cellular",
    "application_tx_bytes_total": 123456,
    "application_rx_bytes_total": 45678
  }
}
```

If a modem or network stack later exposes genuine bearer counters, add them separately:

```json
{
  "data_usage": {
    "counter_epoch": "MODEM-BOOT-001",
    "tx_bytes_total": 123456,
    "rx_bytes_total": 45678
  }
}
```

Only put counters reported by the modem or cellular network stack in the `modem_*` fields. Keep `counter_epoch` unchanged while counters increase; change it after a counter reset. The first sample establishes a baseline and later samples contribute deltas.

Device Management shows:

- accepted upload count;
- exact application request/response bytes;
- device-reported application transfer, including non-ingest API bodies;
- modem-measured transmit and receive bytes when supplied;
- per-device and fleet-wide 30-day totals;
- a 30-day monthly projection using the best available measurement for each device.

Application bytes are a minimum because they exclude some HTTP, TLS and carrier-network overhead. Vodacom billing remains the final source of truth.

## Pass criteria

- Wi-Fi is unavailable during the physical test.
- SIM status is ready and the modem is registered.
- The modem has a Vodacom data IP address.
- Both HTTPS requests return HTTP 200 and `accepted: true`.
- Device Management shows Cellular, Online and a recent last-contact time.
- Telemetry Analytics → **POC simulation** shows one item and R15.00.
- Data usage appears after refreshing Device Management.
