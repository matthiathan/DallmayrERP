import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformTelemetryV652 } from './generate-telemetry-v6-8-52.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino');
const defaultOutputPath = path.join(root, 'firmware/DallmayrTelemetryV6_8_53/DallmayrTelemetryV6_8_53.ino');

export function transformTelemetryV653(input) {
  let source = transformTelemetryV652(input)
    .replace(
      'Dallmayr South Africa - Telemetry V6.8.52 STABLE MDB PROFILE IDENTITY + DEX AUDIT RECONCILIATION',
      'Dallmayr South Africa - Telemetry V6.8.53 FACTORY ZERO-TOUCH + FIRST-CONTACT LOCATION',
    )
    .replace(
      'static const char* FIRMWARE_VERSION = "6.8.52-esp32s3-air780eu-stable-mdb-profile-fingerprint";',
      'static const char* FIRMWARE_VERSION = "6.8.53-esp32s3-air780eu-factory-zero-touch";',
    )
    .replace(
      '#define DALLMAYR_ENROLLMENT_TOKEN       ""',
      '#define DALLMAYR_ENROLLMENT_TOKEN       ""\n#ifndef DALLMAYR_FACTORY_BOOTSTRAP_TOKEN\n#define DALLMAYR_FACTORY_BOOTSTRAP_TOKEN ""\n#endif',
    )
    .replace(
      'String enrollmentToken;\nString supabaseAnonKey = DALLMAYR_SUPABASE_ANON_KEY;',
      'String enrollmentToken;\nString factoryBootstrapToken = DALLMAYR_FACTORY_BOOTSTRAP_TOKEN;\nString modemImei;\nString simIccid;\nString supabaseAnonKey = DALLMAYR_SUPABASE_ANON_KEY;',
    )
    .replace(
      'GnssFix gnssFix;\nString gnssLine;',
      `GnssFix gnssFix;\n\nstruct CellularLbsFix {\n  bool valid = false;\n  double latitude = 0.0;\n  double longitude = 0.0;\n  float accuracyM = NAN;\n};\n\nCellularLbsFix cellularLbsFix;\nString gnssLine;`,
    )
    .replace(
      'enrollmentToken = prefs.getString("enroll_token", DALLMAYR_ENROLLMENT_TOKEN);',
      'enrollmentToken = prefs.getString("enroll_token", DALLMAYR_ENROLLMENT_TOKEN);\n  factoryBootstrapToken = prefs.getString("factory_token", DALLMAYR_FACTORY_BOOTSTRAP_TOKEN);',
    )
    .replace(
      'String readCellOperator() {',
      `String digitsOnly(const String& value) {\n  String out;\n  out.reserve(value.length());\n  for (size_t i = 0; i < value.length(); ++i) {\n    if (isDigit(value[i])) out += value[i];\n  }\n  return out;\n}\n\nString readCellImei() {\n  String digits = digitsOnly(cellQueryText("AT+CGSN", 3000));\n  return (digits.length() >= 14 && digits.length() <= 17) ? digits : String();\n}\n\nString readCellIccid() {\n  String digits = digitsOnly(cellQueryText("AT+CCID", 3000));\n  return (digits.length() >= 18 && digits.length() <= 22) ? digits : String();\n}\n\nbool readCellularLbsFix() {\n  cellularLbsFix = CellularLbsFix();\n  if (pppStarted) return false;\n\n  const char* activeApn = apn.length() ? apn.c_str() : DEFAULT_APN;\n  // Keep LBS isolated from the PPP CID1 profile. SAPBR bearer 3 is opened only\n  // for this best-effort first-contact lookup and is always closed afterwards.\n  if (!cellCommand("AT+SAPBR=3,3,\\"CONTYPE\\",\\"GPRS\\"", "OK", 3500, true)) return false;\n  String apnCommand = String("AT+SAPBR=3,3,\\"APN\\",\\"") + activeApn + "\\"";\n  if (!cellCommand(apnCommand, "OK", 3500, true)) return false;\n  if (!cellCommand("AT+SAPBR=1,3", "OK", 12000, true)) return false;\n\n  String response = cellQueryText("AT+CIPGSMLOC=1,3", 45000);\n  cellCommand("AT+SAPBR=0,3", "OK", 10000, true);\n\n  int marker = response.indexOf("+CIPGSMLOC:");\n  if (marker < 0) return false;\n  String line = response.substring(marker + 12);\n  int newline = line.indexOf('\\n');\n  if (newline >= 0) line = line.substring(0, newline);\n  line.trim();\n\n  int comma1 = line.indexOf(',');\n  int comma2 = comma1 >= 0 ? line.indexOf(',', comma1 + 1) : -1;\n  int comma3 = comma2 >= 0 ? line.indexOf(',', comma2 + 1) : -1;\n  if (comma1 < 0 || comma2 < 0) return false;\n  if (line.substring(0, comma1).toInt() != 0) return false;\n\n  double latitude = line.substring(comma1 + 1, comma2).toDouble();\n  double longitude = line.substring(comma2 + 1, comma3 >= 0 ? comma3 : line.length()).toDouble();\n  if (latitude < -90.0 || latitude > 90.0 || longitude < -180.0 || longitude > 180.0) return false;\n\n  cellularLbsFix.valid = true;\n  cellularLbsFix.latitude = latitude;\n  cellularLbsFix.longitude = longitude;\n  return true;\n}\n\nString readCellOperator() {`,
    )
    .replace(
      'cellularOperator = readCellOperator();\n  cellularCsq = readCellCsq();',
      `cellularOperator = readCellOperator();\n  cellularCsq = readCellCsq();\n  modemImei = readCellImei();\n  simIccid = readCellIccid();\n  if (modemImei.length()) { Serial.print(F("Modem IMEI captured: ")); Serial.println(modemImei); }\n  if (simIccid.length()) { Serial.print(F("SIM ICCID captured: ")); Serial.println(simIccid); }\n  if (readCellularLbsFix()) {\n    Serial.print(F("Cellular LBS first fix: "));\n    Serial.print(cellularLbsFix.latitude, 6);\n    Serial.print(F(", "));\n    Serial.println(cellularLbsFix.longitude, 6);\n  } else {\n    Serial.println(F("Cellular LBS first fix unavailable; enrollment will continue without inventing a location."));\n  }`,
    )
    .replace(
      'if (enrollmentToken.length()) doc["enrollment_token"] = enrollmentToken;\n  doc["hardware_uid"] = hardwareUid;',
      `if (enrollmentToken.length()) doc["enrollment_token"] = enrollmentToken;\n  else if (factoryBootstrapToken.length()) doc["factory_bootstrap_token"] = factoryBootstrapToken;\n  doc["hardware_uid"] = hardwareUid;`,
    )
    .replace(
      'if (reportedMachineSerial.length()) doc["machine_serial"] = reportedMachineSerial;\n\n  String payload;',
      `if (reportedMachineSerial.length()) doc["machine_serial"] = reportedMachineSerial;\n  if (modemImei.length()) doc["modem_imei"] = modemImei;\n  if (simIccid.length()) doc["sim_iccid"] = simIccid;\n  if (cellularOperator.length()) doc["cellular_operator"] = cellularOperator;\n  if (cellularModel.length()) doc["cellular_model"] = cellularModel;\n  if (cellularLbsFix.valid) {\n    JsonObject location = doc["location"].to<JsonObject>();\n    location["latitude"] = cellularLbsFix.latitude;\n    location["longitude"] = cellularLbsFix.longitude;\n    location["source"] = "cellular";\n  } else if (gnssFix.valid) {\n    JsonObject location = doc["location"].to<JsonObject>();\n    location["latitude"] = gnssFix.latitude;\n    location["longitude"] = gnssFix.longitude;\n    location["source"] = "gnss";\n    if (!isnan(gnssFix.accuracyM)) location["accuracy_m"] = gnssFix.accuracyM;\n  }\n\n  String payload;`,
    )
    .replace(
      'Serial.print(enrollmentToken.length() ? "one_time_token" : "administrator_window");',
      'Serial.print(enrollmentToken.length() ? "one_time_token" : (factoryBootstrapToken.length() ? "factory_zero_touch" : "administrator_window"));',
    )
    .replace(
      'Serial.println(F("Waiting for an Administrator to select \'Allow next device\' in DallmayrERP."));',
      'Serial.println(factoryBootstrapToken.length() ? F("Factory bootstrap authorization was rejected; check the provisioned claim.") : F("Waiting for an Administrator enrollment window because no factory bootstrap credential is provisioned."));',
    );

  const requiredMarkers = [
    '6.8.53-esp32s3-air780eu-factory-zero-touch',
    'factory_bootstrap_token',
    'AT+CIPGSMLOC=1,3',
    'modem_imei',
    'sim_iccid',
    'Cellular LBS first fix unavailable; enrollment will continue without inventing a location.',
  ];
  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) throw new Error(`V6.8.53 generation failed: missing ${marker}`);
  }
  if (!/DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/.test(source)) {
    throw new Error('V6.8.53 safety assertion failed: MDB active TX must remain disabled.');
  }
  if (!source.includes('addCommonPayload(doc, "dex_audit_snapshot")')) {
    throw new Error('V6.8.53 generation failed: DEX reconciliation support missing.');
  }

  return source;
}

export async function generateTelemetryV653(outputPath = defaultOutputPath) {
  const source = await readFile(sourcePath, 'utf8');
  const generated = transformTelemetryV653(source);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  return outputPath;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outputPath = await generateTelemetryV653();
  console.log(`Generated ${path.relative(root, outputPath)}`);
}
