import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino');
const defaultOutputPath = path.join(root, 'firmware/DallmayrTelemetryV6_8_48/DallmayrTelemetryV6_8_48.ino');

function replaceOnce(source, needle, replacement, label = needle.slice(0, 80)) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`V6.8.48 generator could not find ${label}.`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`V6.8.48 generator expected exactly one ${label}.`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

function replaceAllChecked(source, needle, replacement, minimum, label = needle) {
  const count = source.split(needle).length - 1;
  if (count < minimum) throw new Error(`V6.8.48 generator found ${count} ${label}; expected at least ${minimum}.`);
  return source.split(needle).join(replacement);
}

export function transformTelemetryV648(input) {
  let source = input;

  source = replaceOnce(
    source,
    'Dallmayr South Africa - Telemetry V6.8.47 DB-POLICY NATIVE MDB + DEX',
    'Dallmayr South Africa - Telemetry V6.8.48 REMOTE MDB PIN-ORDER + DB-POLICY NATIVE MDB + DEX',
    'firmware title',
  );
  source = replaceOnce(
    source,
    'static const char* FIRMWARE_VERSION = "6.8.47-esp32s3-air780eu-stale-ppp-recovery";',
    'static const char* FIRMWARE_VERSION = "6.8.48-esp32s3-air780eu-remote-mdb-pin-order";',
    'firmware version',
  );

  source = replaceOnce(
    source,
    'void applyConfiguredMdbPolarity(bool announce, bool force = false);',
    `void applyConfiguredMdbPolarity(bool announce, bool force = false);\nint mdbMasterMonitorPin();\nint mdbSlaveMonitorPin();\nbool applyConfiguredMdbPinSwap(bool requestedSwap, bool announce, bool force = false);\nvoid stopMdbCapture();\nbool beginMdbCapture();`,
    'MDB forward declarations',
  );

  source = replaceOnce(
    source,
    '  char mdbMasterPolarity[12];\n  char mdbSlavePolarity[12];\n  bool prepaidBalanceEnabled;',
    '  char mdbMasterPolarity[12];\n  char mdbSlavePolarity[12];\n  bool mdbPinSwap;\n  bool prepaidBalanceEnabled;',
    'RuntimePolicy MDB fields',
  );

  source = replaceOnce(
    source,
    '  applied["wifi_enabled"] = policy.wifiEnabled;\n  applied["cellular_enabled"] = policy.cellularEnabled;\n  applied["location_enabled"] = policy.locationEnabled;',
    '  applied["wifi_enabled"] = policy.wifiEnabled;\n  applied["cellular_enabled"] = policy.cellularEnabled;\n  applied["mdb_master_tx_polarity"] = policy.mdbMasterPolarity;\n  applied["mdb_slave_rx_polarity"] = policy.mdbSlavePolarity;\n  applied["mdb_pin_swap"] = policy.mdbPinSwap;\n  applied["mdb_master_tx_gpio"] = mdbMasterMonitorPin();\n  applied["mdb_slave_rx_gpio"] = mdbSlaveMonitorPin();\n  applied["mdb_passive_input_only"] = true;\n  applied["location_enabled"] = policy.locationEnabled;',
    'config acknowledgement controls',
  );

  source = replaceOnce(
    source,
    '  String remoteMasterPolarity = mdbControl["master_tx_polarity"] | "auto";\n  String remoteSlavePolarity = mdbControl["slave_rx_polarity"] | "auto";',
    '  String remoteMasterPolarity = mdbControl["master_tx_polarity"] | "auto";\n  String remoteSlavePolarity = mdbControl["slave_rx_polarity"] | "auto";\n  bool remoteMdbPinSwap = mdbControl["swap_pins"] | false;',
    'remote MDB pin-order parse',
  );

  source = replaceOnce(
    source,
    '  copyText(policy.mdbMasterPolarity, sizeof(policy.mdbMasterPolarity), remoteMasterPolarity);\n  copyText(policy.mdbSlavePolarity, sizeof(policy.mdbSlavePolarity), remoteSlavePolarity);\n  applyConfiguredMdbPolarity(true);',
    '  copyText(policy.mdbMasterPolarity, sizeof(policy.mdbMasterPolarity), remoteMasterPolarity);\n  copyText(policy.mdbSlavePolarity, sizeof(policy.mdbSlavePolarity), remoteSlavePolarity);\n  bool mdbPinOrderApplied = applyConfiguredMdbPinSwap(remoteMdbPinSwap, true);\n  applyConfiguredMdbPolarity(true, mdbPinOrderApplied);',
    'remote MDB control application',
  );

  source = replaceOnce(
    source,
    '  prefs.putString("mdb_mpol", policy.mdbMasterPolarity);\n  prefs.putString("mdb_spol", policy.mdbSlavePolarity);',
    '  prefs.putString("mdb_mpol", policy.mdbMasterPolarity);\n  prefs.putString("mdb_spol", policy.mdbSlavePolarity);\n  prefs.putBool("mdb_swap", policy.mdbPinSwap);',
    'MDB pin-order persistence write',
  );

  source = replaceOnce(
    source,
    '  copyText(policy.mdbMasterPolarity, sizeof(policy.mdbMasterPolarity), "auto");\n  copyText(policy.mdbSlavePolarity, sizeof(policy.mdbSlavePolarity), "auto");\n  policy.prepaidBalanceEnabled = true;',
    '  copyText(policy.mdbMasterPolarity, sizeof(policy.mdbMasterPolarity), "auto");\n  copyText(policy.mdbSlavePolarity, sizeof(policy.mdbSlavePolarity), "auto");\n  policy.mdbPinSwap = false;\n  policy.prepaidBalanceEnabled = true;',
    'MDB pin-order cached default',
  );

  source = replaceOnce(
    source,
    '  String cachedMasterPolarity = prefs.getString("mdb_mpol", "");\n  String cachedSlavePolarity = prefs.getString("mdb_spol", "");',
    '  String cachedMasterPolarity = prefs.getString("mdb_mpol", "");\n  String cachedSlavePolarity = prefs.getString("mdb_spol", "");\n  policy.mdbPinSwap = prefs.getBool("mdb_swap", policy.mdbPinSwap);',
    'MDB pin-order cached read',
  );

  source = replaceOnce(
    source,
    '  Serial.print(F("MDB polarity config: GPIO4/master-TX="));\n  Serial.print(policy.mdbMasterPolarity);\n  Serial.print(F(" GPIO5/master-RX="));\n  Serial.println(policy.mdbSlavePolarity);',
    '  Serial.print(F("MDB input config: pin-order="));\n  Serial.print(policy.mdbPinSwap ? "swapped" : "standard");\n  Serial.print(F(" Master-TX=GPIO"));\n  Serial.print(mdbMasterMonitorPin());\n  Serial.print(F(" polarity="));\n  Serial.print(policy.mdbMasterPolarity);\n  Serial.print(F(" Master-RX=GPIO"));\n  Serial.print(mdbSlaveMonitorPin());\n  Serial.print(F(" polarity="));\n  Serial.println(policy.mdbSlavePolarity);',
    'MDB config sync log',
  );

  const helperAnchor = 'static bool mdbRmtReady = false;';
  const helperBlock = `${helperAnchor}\n\nint mdbMasterMonitorPin() {\n  return policy.mdbPinSwap ? MDB_VMC_RX_MONITOR_PIN : MDB_VMC_TX_MONITOR_PIN;\n}\n\nint mdbSlaveMonitorPin() {\n  return policy.mdbPinSwap ? MDB_VMC_TX_MONITOR_PIN : MDB_VMC_RX_MONITOR_PIN;\n}\n\nbool applyConfiguredMdbPinSwap(bool requestedSwap, bool announce, bool force) {\n  bool changed = force || policy.mdbPinSwap != requestedSwap;\n  if (!changed) return false;\n\n  const bool previousSwap = policy.mdbPinSwap;\n  const bool captureWasRunning = machineInterface == IFACE_MDB && mdbRmtReady;\n  if (captureWasRunning) stopMdbCapture();\n\n  policy.mdbPinSwap = requestedSwap;\n  bool requestedMappingReady = true;\n  if (captureWasRunning) requestedMappingReady = beginMdbCapture();\n\n  if (!requestedMappingReady) {\n    Serial.println(F("MDB pin-order remap failed; rolling back to the last working passive mapping."));\n    policy.mdbPinSwap = previousSwap;\n    if (!beginMdbCapture()) {\n      Serial.println(F("FATAL: MDB capture could not restart after pin-order rollback; interface disabled."));\n      machineInterface = IFACE_DISABLED;\n      saveCoreSettings();\n    }\n    return false;\n  }\n\n  heartbeatUploadRequested = true;\n  if (announce) {\n    Serial.print(F("MDB passive pin order applied: "));\n    Serial.print(policy.mdbPinSwap ? "SWAPPED" : "STANDARD");\n    Serial.print(F(" · Master-TX -> GPIO"));\n    Serial.print(mdbMasterMonitorPin());\n    Serial.print(F(" · Master-RX -> GPIO"));\n    Serial.print(mdbSlaveMonitorPin());\n    Serial.println(F(" · both INPUT-ONLY"));\n  }\n  return true;\n}`;
  source = replaceOnce(source, helperAnchor, helperBlock, 'MDB RMT runtime state');

  const pinApiReplacements = [
    ['rmtReadAsync(MDB_VMC_TX_MONITOR_PIN', 'rmtReadAsync(mdbMasterMonitorPin()'],
    ['rmtReadAsync(MDB_VMC_RX_MONITOR_PIN', 'rmtReadAsync(mdbSlaveMonitorPin()'],
    ['rmtReceiveCompleted(MDB_VMC_TX_MONITOR_PIN)', 'rmtReceiveCompleted(mdbMasterMonitorPin())'],
    ['rmtReceiveCompleted(MDB_VMC_RX_MONITOR_PIN)', 'rmtReceiveCompleted(mdbSlaveMonitorPin())'],
    ['rmtInit(MDB_VMC_TX_MONITOR_PIN', 'rmtInit(mdbMasterMonitorPin()'],
    ['rmtInit(MDB_VMC_RX_MONITOR_PIN', 'rmtInit(mdbSlaveMonitorPin()'],
    ['rmtSetRxMinThreshold(MDB_VMC_TX_MONITOR_PIN', 'rmtSetRxMinThreshold(mdbMasterMonitorPin()'],
    ['rmtSetRxMinThreshold(MDB_VMC_RX_MONITOR_PIN', 'rmtSetRxMinThreshold(mdbSlaveMonitorPin()'],
    ['rmtSetRxMaxThreshold(MDB_VMC_TX_MONITOR_PIN', 'rmtSetRxMaxThreshold(mdbMasterMonitorPin()'],
    ['rmtSetRxMaxThreshold(MDB_VMC_RX_MONITOR_PIN', 'rmtSetRxMaxThreshold(mdbSlaveMonitorPin()'],
    ['rmtDeinit(MDB_VMC_TX_MONITOR_PIN)', 'rmtDeinit(mdbMasterMonitorPin())'],
    ['rmtDeinit(MDB_VMC_RX_MONITOR_PIN)', 'rmtDeinit(mdbSlaveMonitorPin())'],
  ];
  for (const [needle, replacement] of pinApiReplacements) {
    source = replaceAllChecked(source, needle, replacement, 1, `dynamic RMT call ${needle}`);
  }

  source = replaceOnce(
    source,
    '  Serial.print(F("Native passive MDB decoder active: GREEN/Master-TX -> GPIO"));\n  Serial.print(MDB_VMC_TX_MONITOR_PIN);\n  Serial.print(F(", YELLOW/Master-RX -> GPIO"));\n  Serial.println(MDB_VMC_RX_MONITOR_PIN);',
    '  Serial.print(F("Native passive MDB decoder active: pin-order="));\n  Serial.print(policy.mdbPinSwap ? "swapped" : "standard");\n  Serial.print(F(", Master-TX -> GPIO"));\n  Serial.print(mdbMasterMonitorPin());\n  Serial.print(F(", Master-RX -> GPIO"));\n  Serial.println(mdbSlaveMonitorPin());',
    'MDB capture startup log',
  );

  source = replaceOnce(
    source,
    '  Serial.print  (F("GREEN  : MDB pin 5 / Master Transmit -> isolated receiver -> ESP32 GPIO"));\n  Serial.println(MDB_VMC_TX_MONITOR_PIN);\n  Serial.print  (F("YELLOW : MDB pin 4 / Master Receive  -> isolated receiver -> ESP32 GPIO"));\n  Serial.println(MDB_VMC_RX_MONITOR_PIN);',
    '  Serial.print  (F("Pin order: ")); Serial.println(policy.mdbPinSwap ? "SWAPPED" : "STANDARD");\n  Serial.print  (F("GREEN  : MDB pin 5 / Master Transmit -> isolated receiver -> ESP32 GPIO"));\n  Serial.println(mdbMasterMonitorPin());\n  Serial.print  (F("YELLOW : MDB pin 4 / Master Receive  -> isolated receiver -> ESP32 GPIO"));\n  Serial.println(mdbSlaveMonitorPin());',
    'MDB wiring map',
  );

  source = replaceOnce(
    source,
    '    Serial.print(F("MDB GPIO4/master-TX polarity configured: "));\n    Serial.println(policy.mdbMasterPolarity);\n    Serial.print(F("MDB GPIO4/master-TX polarity effective: "));\n    Serial.println(mdbMasterInvert < 0 ? "learning" : (mdbMasterInvert ? "inverted" : "normal"));\n    Serial.print(F("MDB GPIO5/master-RX polarity configured: "));\n    Serial.println(policy.mdbSlavePolarity);\n    Serial.print(F("MDB GPIO5/master-RX polarity effective: "));\n    Serial.println(mdbSlaveInvert < 0 ? "learning" : (mdbSlaveInvert ? "inverted" : "normal"));',
    '    Serial.print(F("MDB pin order: ")); Serial.println(policy.mdbPinSwap ? "swapped" : "standard");\n    Serial.print(F("MDB Master-TX GPIO: ")); Serial.println(mdbMasterMonitorPin());\n    Serial.print(F("MDB Master-TX polarity configured: "));\n    Serial.println(policy.mdbMasterPolarity);\n    Serial.print(F("MDB Master-TX polarity effective: "));\n    Serial.println(mdbMasterInvert < 0 ? "learning" : (mdbMasterInvert ? "inverted" : "normal"));\n    Serial.print(F("MDB Master-RX GPIO: ")); Serial.println(mdbSlaveMonitorPin());\n    Serial.print(F("MDB Master-RX polarity configured: "));\n    Serial.println(policy.mdbSlavePolarity);\n    Serial.print(F("MDB Master-RX polarity effective: "));\n    Serial.println(mdbSlaveInvert < 0 ? "learning" : (mdbSlaveInvert ? "inverted" : "normal"));',
    'MDB status output',
  );

  source = replaceOnce(
    source,
    '  Serial.println(F("MDB is native/passive on ESP32-S3 RMT. GPIO4/GPIO5 remain input-only."));',
    '  Serial.println(F("MDB is native/passive on ESP32-S3 RMT. GPIO4/GPIO5 remain input-only; pin order follows remote Device Management."));',
    'MDB help output',
  );

  if (!source.includes('control["mdb"]') || !source.includes('mdbControl["swap_pins"]')) {
    throw new Error('Generated V6.8.48 is missing the remote MDB pin-order contract.');
  }
  if (source.includes('rmtReadAsync(MDB_VMC_TX_MONITOR_PIN') || source.includes('rmtReceiveCompleted(MDB_VMC_RX_MONITOR_PIN)')) {
    throw new Error('Generated V6.8.48 still contains hard-coded logical-role RMT receive calls.');
  }
  return source;
}

export async function generateTelemetryV648(outputPath = defaultOutputPath) {
  const source = await readFile(sourcePath, 'utf8');
  const generated = transformTelemetryV648(source);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  return outputPath;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const output = process.env.DALLMAYR_V648_OUTPUT
    ? path.resolve(process.env.DALLMAYR_V648_OUTPUT)
    : defaultOutputPath;
  await generateTelemetryV648(output);
  console.log(`Generated ${path.relative(root, output)} from validated V6.8.47 production firmware.`);
}
