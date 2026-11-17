import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformTelemetryV652 } from './generate-telemetry-v6-8-52.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function replace(source, needle, value) {
  if (source.split(needle).length !== 2)
    throw new Error(`V653 anchor is not unique: ${needle.slice(0, 70)}`);
  return source.replace(needle, value);
}
export function transformTelemetryV653(input) {
  let source = transformTelemetryV652(input)
    .replaceAll(
      '6.8.52-esp32s3-air780eu-stable-mdb-profile-fingerprint',
      '6.8.53-esp32s3-cellular-first-signed-ota',
    )
    .replaceAll('Telemetry V6.8.52', 'Telemetry V6.8.53');
  source = replace(
    source,
    '#include <ArduinoJson.h>',
    '#include <ArduinoJson.h>\n#include "CellularFirst.h"\n#include "FirmwareTrust.h"\nCellularFirst cellularRouting;\nvoid otaAcceptConfig(JsonVariantConst manifest);\nvoid otaRecordHealth();\nvoid otaAddStatus(JsonDocument& doc);',
  );
  const orderStart = source.indexOf('void getTransportOrder(');
  const orderEnd = source.indexOf('\nbool postRawWithFailover', orderStart);
  if (orderStart < 0 || orderEnd < 0)
    throw new Error('Missing transport order boundary');
  source =
    source.slice(0, orderStart) +
    `void getTransportOrder(const char*& first, const char*& second) {
  // SIM is always the preferred path. Wi-Fi is temporary backend-failure recovery.
  bool cellularFirst = cellularRouting.preferCellular(millis()) || !wifiReady();
  first = cellularFirst ? "cellular" : "wifi";
  second = cellularFirst ? "wifi" : "cellular";
}
` +
    source.slice(orderEnd);
  const maintainStart = source.indexOf(
    '  String preferredTransport = policy.transportPreference;',
    source.indexOf('void maintainCellular()'),
  );
  const maintainEnd = source.indexOf('  // A stale PPP session', maintainStart);
  if (maintainStart < 0 || maintainEnd < 0)
    throw new Error('Missing modem lifecycle boundary');
  source =
    source.slice(0, maintainStart) +
    '  // Keep PPP available even while Wi-Fi is connected; the SIM remains primary.\n' +
    source.slice(maintainEnd);
  source = replace(
    source,
    '  noteCellularHttpsResult(statusCode);',
    '  noteCellularHttpsResult(statusCode);\n  cellularRouting.result(millis(), statusCode);',
  );
  source = replace(
    source,
    '  if (!doc["accepted"].as<bool>()) return false;\n\n  JsonObject p',
    '  if (!doc["accepted"].as<bool>()) return false;\n  otaAcceptConfig(doc["firmware_update"]);\n\n  JsonObject p',
  );
  source = replace(
    source,
    '  policy.cellularEnabled = control["cellular_enabled"] | true;',
    '  policy.cellularEnabled = true;\n  copyText(policy.transportPreference, sizeof(policy.transportPreference), "cellular");',
  );
  source = replace(
    source,
    '  policy.heartbeatIntervalMinutes = p["heartbeat_interval_minutes"] | 1;',
    '  policy.heartbeatIntervalMinutes = 1;',
  );
  source = replace(
    source,
    '  policy.heartbeatIntervalMinutes = prefs.getULong("hbmin", policy.heartbeatIntervalMinutes);',
    '  policy.heartbeatIntervalMinutes = 1;\n  policy.cellularEnabled = true;\n  copyText(policy.transportPreference, sizeof(policy.transportPreference), "cellular");',
  );
  source = replace(
    source,
    '  uint32_t intervalMinutes = policy.heartbeatIntervalMinutes == 0\n    ? 1 : policy.heartbeatIntervalMinutes;',
    '  uint32_t intervalMinutes = 1;',
  );
  source = source.replaceAll(
    '  addPrepaidBalanceMetadata(doc);',
    '  addPrepaidBalanceMetadata(doc);\n  otaAddStatus(doc);',
  );
  source = source.replaceAll(
    '    heartbeatUploadRequested = false;\n    lastHeartbeatUploadSuccessMs',
    '    heartbeatUploadRequested = false;\n    otaRecordHealth();\n    lastHeartbeatUploadSuccessMs',
  );
  source = replace(
    source,
    'void setup() {',
    '#include "FirmwareUpdate.h"\n\nvoid setup() {',
  );
  source = replace(
    source,
    '  loadCounters();\n  memset(faults',
    '  loadCounters();\n  otaBootStart();\n  memset(faults',
  );
  source = replace(
    source,
    '  serviceRemoteDebug();\n  delay(2);',
    '  serviceRemoteDebug();\n  serviceFirmwareUpdate();\n  delay(2);',
  );
  source = source.replace(
    'Power-on flow: DB transport policy -> Wi-Fi when primary -> Air780EU manual PPP recovery/primary -> ESP32 TLS -> Supabase.',
    'Power-on flow: Air780EU cellular first -> authenticated backend -> Wi-Fi fallback only if required.',
  );
  source = replace(
    source,
    'void handleConsoleLine(String line) {',
    `void handleConsoleLine(String line) {
  if (line.startsWith("DEVICE PROVISION ")) {
    String value=line.substring(17); int divider=value.indexOf('|');
    if (divider<0 || value.substring(0,divider)!=deviceId || value.length()-divider-1!=64) {
      Serial.println(F("Provisioning rejected: device ID or 64-character private key is invalid.")); return;
    }
    String key=value.substring(divider+1);
    for (size_t i=0;i<key.length();++i) if (!isxdigit(key[i])) { Serial.println(F("Invalid provisioning key.")); return; }
    if (deviceEnrolled()) { Serial.println(F("Already provisioned; existing credentials preserved.")); return; }
    prefs.begin("dallmayr",false); size_t saved=prefs.putString("device_key",key); prefs.end();
    if (!saved) { Serial.println(F("Credential storage failed.")); return; }
    deviceKey=key; lastEnrollmentAttemptMs=0;
    Serial.println(F("Device provisioned. Private credential stored without echo.")); return;
  }`,
  );
  source = source.replaceAll(
    '  tls.setInsecure();',
    '  if (strlen(DALLMAYR_OTA_CA_PEM)>100) tls.setCACert(DALLMAYR_OTA_CA_PEM); else tls.setInsecure();',
  );
  source = replace(
    source,
    '  WiFi.persistent(false);',
    '  configTime(0, 0, "time.cloudflare.com", "pool.ntp.org");\n  WiFi.persistent(false);',
  );
  return source;
}
export async function generateTelemetryV653() {
  const input = await readFile(
    path.join(
      root,
      'firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino',
    ),
    'utf8',
  );
  const out = path.join(root, 'firmware/DallmayrTelemetryV6_8_53');
  await mkdir(out, { recursive: true });
  const generated = transformTelemetryV653(input);
  const hash = createHash('sha256').update(generated);
  for (const name of [
    'CellularFirst.h',
    'OtaBootPolicy.h',
    'FirmwareUpdate.h',
    'FirmwareTrust.h',
  ])
    hash.update(await readFile(path.join(root, 'firmware/shared', name)));
  hash.update(
    await readFile(
      path.join(
        root,
        'firmware/DallmayrTelemetryV6_8_52/ZZ_CellularLbsLocation.ino',
      ),
    ),
  );
  await writeFile(
    path.join(out, 'DallmayrTelemetryV6_8_53.ino'),
    `#define DALLMAYR_SOURCE_SHA256 "${hash.digest('hex')}"\n` + generated,
  );
  for (const name of [
    'CellularFirst.h',
    'OtaBootPolicy.h',
    'FirmwareUpdate.h',
    'FirmwareTrust.h',
  ])
    await copyFile(
      path.join(root, 'firmware/shared', name),
      path.join(out, name),
    );
  await copyFile(
    path.join(
      root,
      'firmware/DallmayrTelemetryV6_8_52/ZZ_CellularLbsLocation.ino',
    ),
    path.join(out, 'ZZ_CellularLbsLocation.ino'),
  );
  return out;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  console.log(await generateTelemetryV653());
