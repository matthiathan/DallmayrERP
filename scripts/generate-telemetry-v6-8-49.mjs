import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformTelemetryV648 } from './generate-telemetry-v6-8-48.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino');
const defaultOutputPath = path.join(root, 'firmware/DallmayrTelemetryV6_8_49/DallmayrTelemetryV6_8_49.ino');

function replaceOnce(source, needle, replacement, label = needle.slice(0, 80)) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`V6.8.49 generator could not find ${label}.`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`V6.8.49 generator expected exactly one ${label}.`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

export function transformTelemetryV649(input) {
  let source = transformTelemetryV648(input);

  source = source
    .replace('Dallmayr South Africa - Telemetry V6.8.48 REMOTE MDB PIN-ORDER + DB-POLICY NATIVE MDB + DEX', 'Dallmayr South Africa - Telemetry V6.8.49 PASSIVE MDB SELECTION LEARN MODE + DEX')
    .replace('static const char* FIRMWARE_VERSION = "6.8.48-esp32s3-air780eu-remote-mdb-pin-order";', 'static const char* FIRMWARE_VERSION = "6.8.49-esp32s3-air780eu-passive-mdb-selection-learn";');

  source = replaceOnce(
    source,
    `enum MdbTelemetryEventType : uint8_t {\n  MDB_EVENT_VEND = 1,\n  MDB_EVENT_CASHLESS_ERROR_SET = 2,\n  MDB_EVENT_CASHLESS_ERROR_CLEAR = 3,\n  MDB_EVENT_OUT_OF_SEQUENCE_SET = 4,\n  MDB_EVENT_OUT_OF_SEQUENCE_CLEAR = 5\n};`,
    `enum MdbTelemetryEventType : uint8_t {\n  MDB_EVENT_VEND = 1,\n  MDB_EVENT_CASHLESS_ERROR_SET = 2,\n  MDB_EVENT_CASHLESS_ERROR_CLEAR = 3,\n  MDB_EVENT_OUT_OF_SEQUENCE_SET = 4,\n  MDB_EVENT_OUT_OF_SEQUENCE_CLEAR = 5,\n  MDB_EVENT_SELECTION_OBSERVATION = 6\n};\n\nenum MdbSelectionObservationStage : uint8_t {\n  MDB_SELECTION_REQUESTED = 1,\n  MDB_SELECTION_APPROVED = 2,\n  MDB_SELECTION_DENIED = 3,\n  MDB_SELECTION_SUCCESS = 4,\n  MDB_SELECTION_FAILURE = 5\n};`,
    'MDB telemetry event enum',
  );

  source = replaceOnce(
    source,
    `  uint8_t reason;\n  uint16_t selection;\n  uint32_t priceCents;\n  bool success;\n};`,
    `  uint8_t reason;\n  uint8_t observationStage;\n  uint16_t selection;\n  uint32_t priceCents;\n  bool success;\n};`,
    'MDB telemetry event fields',
  );

  source = replaceOnce(
    source,
    `void mdbRecordVend(uint16_t selection, uint32_t priceCents, bool success, const char* reason) {\n  if (mdbVendIsDuplicate(selection, priceCents, success)) return;\n\n  MdbTelemetryEvent event = {};\n  event.type = MDB_EVENT_VEND;\n  event.selection = selection;\n  event.priceCents = priceCents;\n  event.success = success;\n  event.reason = mdbVendReasonFromText(reason);\n  mdbQueueTelemetryEvent(event);\n}`,
    `void mdbRecordSelectionObservation(uint8_t readerIndex, uint16_t selection, uint32_t priceCents, uint8_t stage, const char* reason) {\n  if (selection == 0xFFFF) {\n    Serial.println(F("MDB selection observation skipped: item number is undefined (FFFF)."));\n    return;\n  }\n  MdbTelemetryEvent event = {};\n  event.type = MDB_EVENT_SELECTION_OBSERVATION;\n  event.readerIndex = readerIndex;\n  event.selection = selection;\n  event.priceCents = priceCents;\n  event.observationStage = stage;\n  event.reason = mdbVendReasonFromText(reason);\n  mdbQueueTelemetryEvent(event);\n}\n\nvoid mdbRecordVend(uint16_t selection, uint32_t priceCents, bool success, const char* reason) {\n  if (mdbVendIsDuplicate(selection, priceCents, success)) return;\n\n  MdbTelemetryEvent event = {};\n  event.type = MDB_EVENT_VEND;\n  event.selection = selection;\n  event.priceCents = priceCents;\n  event.success = success;\n  event.reason = mdbVendReasonFromText(reason);\n  mdbQueueTelemetryEvent(event);\n\n  mdbRecordSelectionObservation(0, selection, priceCents,\n    success ? MDB_SELECTION_SUCCESS : MDB_SELECTION_FAILURE, reason);\n}`,
    'MDB vend event recorder',
  );

  source = replaceOnce(
    source,
    `const char* mdbVendReasonName(uint8_t reason) {\n  switch (reason) {`,
    `const char* mdbSelectionObservationStageName(uint8_t stage) {\n  switch (stage) {\n    case MDB_SELECTION_REQUESTED: return "requested";\n    case MDB_SELECTION_APPROVED: return "approved";\n    case MDB_SELECTION_DENIED: return "denied";\n    case MDB_SELECTION_SUCCESS: return "success";\n    case MDB_SELECTION_FAILURE: return "failure";\n    default: return "observed";\n  }\n}\n\nconst char* mdbSelectionObservationConfidence(uint8_t stage) {\n  switch (stage) {\n    case MDB_SELECTION_SUCCESS: return "confirmed";\n    case MDB_SELECTION_FAILURE:\n    case MDB_SELECTION_DENIED: return "failed";\n    case MDB_SELECTION_APPROVED: return "probable";\n    default: return "observed";\n  }\n}\n\nconst char* mdbVendReasonName(uint8_t reason) {\n  switch (reason) {`,
    'MDB observation stage names',
  );

  source = replaceOnce(
    source,
    `    if (event.type == MDB_EVENT_VEND) {\n      String selectionText = mdbSelectionText(event.selection);`,
    `    if (event.type == MDB_EVENT_SELECTION_OBSERVATION) {\n      String selectionText = mdbSelectionText(event.selection);\n      JsonDocument doc;\n      addCommonPayload(doc, "selection_observation");\n      doc["interface"] = "mdb";\n      doc["selection_code"] = selectionText;\n      doc["item_number"] = event.selection;\n      doc["price_minor"] = event.priceCents;\n      doc["currency"] = "ZAR";\n      doc["result"] = mdbSelectionObservationStageName(event.observationStage);\n      doc["source"] = "mdb";\n      doc["confirmation"] = event.observationStage == MDB_SELECTION_REQUESTED ? "vend_request" : mdbVendReasonName(event.reason);\n      doc["confidence"] = mdbSelectionObservationConfidence(event.observationStage);\n      doc["reader_index"] = event.readerIndex;\n      String eventId = String(bootId) + ":mdb-selection:" + String(sequenceNumber);\n      doc["event_id"] = eventId;\n\n      bool uploaded = sendDocumentToIngest(doc);\n      Serial.print(F("MDB learn observation "));\n      Serial.print(mdbSelectionObservationStageName(event.observationStage));\n      Serial.print(F(" selection="));\n      Serial.print(selectionText);\n      Serial.print(F(" upload="));\n      Serial.println(uploaded ? F("ok") : F("deferred/lost"));\n      continue;\n    }\n\n    if (event.type == MDB_EVENT_VEND) {\n      String selectionText = mdbSelectionText(event.selection);`,
    'MDB telemetry event consumer',
  );

  source = replaceOnce(
    source,
    `      cashless.requestedScaledPrice = mdbReadBigEndian(block, 2, priceBytes);\n      cashless.selection = static_cast<uint16_t>(mdbReadBigEndian(block, itemOffset, 2));\n      cashless.approvedScaledPrice = 0;\n      cashless.vendPending = true;\n      cashless.vendApproved = false;\n      cashless.vendStartedMs = millis();\n      break;`,
    `      cashless.requestedScaledPrice = mdbReadBigEndian(block, 2, priceBytes);\n      cashless.selection = static_cast<uint16_t>(mdbReadBigEndian(block, itemOffset, 2));\n      cashless.approvedScaledPrice = 0;\n      cashless.vendPending = true;\n      cashless.vendApproved = false;\n      cashless.vendStartedMs = millis();\n      uint32_t requestedCents = mdbScaledToCents(cashless.requestedScaledPrice, cashless.scaleFactor, cashless.decimalPlaces);\n      mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), cashless.selection, requestedCents, MDB_SELECTION_REQUESTED, "mdb");\n      break;`,
    'MDB vend request observation',
  );

  source = replaceOnce(
    source,
    `      cashless.vendApproved = true;\n      break;\n    }\n\n    case 0x06: // VEND DENIED\n      cashless.vendApproved = false;`,
    `      cashless.vendApproved = true;\n      mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), cashless.selection,\n        mdbScaledToCents(cashless.approvedScaledPrice ? cashless.approvedScaledPrice : cashless.requestedScaledPrice, cashless.scaleFactor, cashless.decimalPlaces),\n        MDB_SELECTION_APPROVED, "mdb");\n      break;\n    }\n\n    case 0x06: // VEND DENIED\n      mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), cashless.selection,\n        mdbScaledToCents(cashless.requestedScaledPrice, cashless.scaleFactor, cashless.decimalPlaces),\n        MDB_SELECTION_DENIED, "cashless_vend_failure");\n      cashless.vendApproved = false;`,
    'MDB vend approval and denial observations',
  );

  source = replaceOnce(
    source,
    '  Serial.println(F("MDB is native/passive on ESP32-S3 RMT. GPIO4/GPIO5 remain input-only; pin order follows remote Device Management."));',
    '  Serial.println(F("MDB is native/passive on ESP32-S3 RMT. GPIO4/GPIO5 remain input-only; Learn Mode observes selection IDs and never transmits onto MDB."));',
    'MDB help learn-mode output',
  );

  if (!source.includes('MDB_EVENT_SELECTION_OBSERVATION') || !source.includes('selection_observation')) {
    throw new Error('Generated V6.8.49 is missing selection Learn Mode.');
  }
  if (!/DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/.test(source)) {
    throw new Error('Generated V6.8.49 must retain passive-only MDB TX safety.');
  }
  if (source.includes('static const char* FIRMWARE_VERSION = "6.8.48-')) {
    throw new Error('Generated V6.8.49 still reports the V6.8.48 firmware version.');
  }
  return source;
}

export async function generateTelemetryV649(outputPath = defaultOutputPath) {
  const source = await readFile(sourcePath, 'utf8');
  const generated = transformTelemetryV649(source);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  return outputPath;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const output = process.env.DALLMAYR_V649_OUTPUT ? path.resolve(process.env.DALLMAYR_V649_OUTPUT) : defaultOutputPath;
  await generateTelemetryV649(output);
  console.log(`Generated ${path.relative(root, output)} with passive MDB selection Learn Mode.`);
}
