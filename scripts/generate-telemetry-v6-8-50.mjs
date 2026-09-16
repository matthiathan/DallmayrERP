import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformTelemetryV649 } from './generate-telemetry-v6-8-49.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino');
const defaultOutputPath = path.join(root, 'firmware/DallmayrTelemetryV6_8_50/DallmayrTelemetryV6_8_50.ino');

function replaceOnce(source, needle, replacement, label = needle.slice(0, 80)) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`V6.8.50 generator could not find ${label}.`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`V6.8.50 generator expected exactly one ${label}.`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

export function transformTelemetryV650(input) {
  let source = transformTelemetryV649(input);

  source = source
    .replace(
      'Dallmayr South Africa - Telemetry V6.8.49 PASSIVE MDB SELECTION LEARN MODE + DEX',
      'Dallmayr South Africa - Telemetry V6.8.50 PASSIVE MDB VEND EVIDENCE + SELECTION LEARN MODE + DEX',
    )
    .replace(
      'static const char* FIRMWARE_VERSION = "6.8.49-esp32s3-air780eu-passive-mdb-selection-learn";',
      'static const char* FIRMWARE_VERSION = "6.8.50-esp32s3-air780eu-passive-mdb-vend-evidence";',
    );

  source = replaceOnce(
    source,
    `  bool vendPending = false;\n  bool vendApproved = false;\n  uint16_t selection = 0xFFFF;\n  uint32_t requestedScaledPrice = 0;\n  uint32_t approvedScaledPrice = 0;\n  uint32_t vendStartedMs = 0;`,
    `  bool vendPending = false;\n  bool vendApproved = false;\n  uint16_t selection = 0xFFFF;\n  uint32_t requestedScaledPrice = 0;\n  uint32_t approvedScaledPrice = 0;\n  uint32_t vendStartedMs = 0;\n  uint32_t vendCorrelationId = 0;\n  uint16_t vendCorrelationOrdinal = 0;`,
    'MDB cashless vend correlation state',
  );

  source = replaceOnce(
    source,
    `  uint8_t reason;\n  uint8_t observationStage;\n  uint16_t selection;\n  uint32_t priceCents;\n  bool success;`,
    `  uint8_t reason;\n  uint8_t observationStage;\n  uint16_t selection;\n  uint32_t priceCents;\n  uint32_t correlationId;\n  uint16_t correlationOrdinal;\n  bool success;`,
    'MDB event correlation fields',
  );

  source = replaceOnce(
    source,
    `static MdbCashlessState mdbCashless[2];\nstatic MdbLastMasterContext mdbLastMaster;\nstatic MdbVendDedup mdbLastVend;`,
    `static MdbCashlessState mdbCashless[2];\nstatic MdbLastMasterContext mdbLastMaster;\nstatic MdbVendDedup mdbLastVend;\nstatic uint32_t mdbVendCorrelationCounter = 0;\n\nuint32_t mdbNextVendCorrelationId() {\n  mdbVendCorrelationCounter++;\n  if (mdbVendCorrelationCounter == 0) mdbVendCorrelationCounter = 1;\n  return mdbVendCorrelationCounter;\n}`,
    'MDB vend correlation counter',
  );

  source = replaceOnce(
    source,
    `void mdbRecordSelectionObservation(uint8_t readerIndex, uint16_t selection, uint32_t priceCents, uint8_t stage, const char* reason) {\n  if (selection == 0xFFFF) {\n    Serial.println(F("MDB selection observation skipped: item number is undefined (FFFF)."));\n    return;\n  }\n  MdbTelemetryEvent event = {};\n  event.type = MDB_EVENT_SELECTION_OBSERVATION;\n  event.readerIndex = readerIndex;\n  event.selection = selection;\n  event.priceCents = priceCents;\n  event.observationStage = stage;\n  event.reason = mdbVendReasonFromText(reason);\n  mdbQueueTelemetryEvent(event);\n}\n\nvoid mdbRecordVend(uint16_t selection, uint32_t priceCents, bool success, const char* reason) {\n  if (mdbVendIsDuplicate(selection, priceCents, success)) return;\n\n  MdbTelemetryEvent event = {};\n  event.type = MDB_EVENT_VEND;\n  event.selection = selection;\n  event.priceCents = priceCents;\n  event.success = success;\n  event.reason = mdbVendReasonFromText(reason);\n  mdbQueueTelemetryEvent(event);\n\n  mdbRecordSelectionObservation(0, selection, priceCents,\n    success ? MDB_SELECTION_SUCCESS : MDB_SELECTION_FAILURE, reason);\n}`,
    `void mdbRecordSelectionObservation(uint8_t readerIndex, uint16_t selection, uint32_t priceCents, uint8_t stage, const char* reason, uint32_t correlationId, uint16_t correlationOrdinal) {\n  if (selection == 0xFFFF) {\n    Serial.println(F("MDB selection observation skipped: item number is undefined (FFFF)."));\n    return;\n  }\n  MdbTelemetryEvent event = {};\n  event.type = MDB_EVENT_SELECTION_OBSERVATION;\n  event.readerIndex = readerIndex;\n  event.selection = selection;\n  event.priceCents = priceCents;\n  event.observationStage = stage;\n  event.reason = mdbVendReasonFromText(reason);\n  event.correlationId = correlationId;\n  event.correlationOrdinal = correlationOrdinal;\n  mdbQueueTelemetryEvent(event);\n}\n\nbool mdbRecordVend(uint16_t selection, uint32_t priceCents, bool success, const char* reason) {\n  if (mdbVendIsDuplicate(selection, priceCents, success)) return false;\n\n  MdbTelemetryEvent event = {};\n  event.type = MDB_EVENT_VEND;\n  event.selection = selection;\n  event.priceCents = priceCents;\n  event.success = success;\n  event.reason = mdbVendReasonFromText(reason);\n  return mdbQueueTelemetryEvent(event);\n}`,
    'MDB correlated observation and vend recorder',
  );

  source = replaceOnce(
    source,
    `void serviceMdbTelemetryEvents(uint8_t maxEvents = 24) {`,
    `const char* mdbVendEvidenceEventName(const MdbTelemetryEvent& event) {\n  switch (event.observationStage) {\n    case MDB_SELECTION_REQUESTED: return "vend_request";\n    case MDB_SELECTION_APPROVED: return "vend_approved";\n    case MDB_SELECTION_DENIED: return "vend_denied";\n    case MDB_SELECTION_FAILURE: return "vend_failure";\n    case MDB_SELECTION_SUCCESS:\n      if (event.reason == MDB_VEND_CASH_SALE || event.reason == MDB_VEND_FREE_VEND) return "cash_sale";\n      return "vend_success";\n    default: return nullptr;\n  }\n}\n\nuint8_t mdbVendEvidenceConfidence(const MdbTelemetryEvent& event) {\n  switch (event.observationStage) {\n    case MDB_SELECTION_REQUESTED: return 30;\n    case MDB_SELECTION_APPROVED: return 60;\n    case MDB_SELECTION_DENIED:\n    case MDB_SELECTION_FAILURE: return 100;\n    case MDB_SELECTION_SUCCESS:\n      return event.reason == MDB_VEND_CASH_SALE || event.reason == MDB_VEND_FREE_VEND ? 95 : 100;\n    default: return 0;\n  }\n}\n\nString mdbVendEvidenceKey(const MdbTelemetryEvent& event) {\n  String key = String(bootId) + ":mdb:r" + String(event.readerIndex + 1) + ":" + String(event.correlationId);\n  if (event.correlationOrdinal > 0) key += ":" + String(event.correlationOrdinal);\n  return key;\n}\n\nbool uploadMdbVendEvidence(const MdbTelemetryEvent& event) {\n  if (event.correlationId == 0 || event.selection == 0xFFFF) return false;\n  const char* evidenceEvent = mdbVendEvidenceEventName(event);\n  if (!evidenceEvent) return false;\n\n  JsonDocument doc;\n  addCommonPayload(doc, "vend_evidence");\n  doc["source"] = "mdb";\n  doc["event"] = evidenceEvent;\n  doc["selection_code"] = mdbSelectionText(event.selection);\n  doc["vend_key"] = mdbVendEvidenceKey(event);\n  doc["quantity"] = 1;\n  doc["price_cents"] = event.priceCents;\n  doc["confidence_score"] = mdbVendEvidenceConfidence(event);\n\n  JsonObject metadata = doc["metadata"].to<JsonObject>();\n  metadata["reader_index"] = event.readerIndex;\n  metadata["reader_number"] = event.readerIndex + 1;\n  metadata["observation_stage"] = mdbSelectionObservationStageName(event.observationStage);\n  metadata["reason"] = mdbVendReasonName(event.reason);\n  metadata["correlation_ordinal"] = event.correlationOrdinal;\n  metadata["counter_accounting"] = "separate_cumulative_snapshot";\n\n  return sendDocumentToIngest(doc);\n}\n\nvoid serviceMdbTelemetryEvents(uint8_t maxEvents = 24) {`,
    'MDB vend evidence uploader helpers',
  );

  const oldObservationConsumer = `    if (event.type == MDB_EVENT_SELECTION_OBSERVATION) {\n      String selectionText = mdbSelectionText(event.selection);\n      JsonDocument doc;\n      addCommonPayload(doc, "selection_observation");\n      doc["interface"] = "mdb";\n      doc["selection_code"] = selectionText;\n      doc["item_number"] = event.selection;\n      doc["price_minor"] = event.priceCents;\n      doc["currency"] = "ZAR";\n      doc["result"] = mdbSelectionObservationStageName(event.observationStage);\n      doc["source"] = "mdb";\n      doc["confirmation"] = event.observationStage == MDB_SELECTION_REQUESTED ? "vend_request" : mdbVendReasonName(event.reason);\n      doc["confidence"] = mdbSelectionObservationConfidence(event.observationStage);\n      doc["reader_index"] = event.readerIndex;\n      String eventId = String(bootId) + ":mdb-selection:" + String(sequenceNumber);\n      doc["event_id"] = eventId;\n\n      bool uploaded = sendDocumentToIngest(doc);\n      Serial.print(F("MDB learn observation "));\n      Serial.print(mdbSelectionObservationStageName(event.observationStage));\n      Serial.print(F(" selection="));\n      Serial.print(selectionText);\n      Serial.print(F(" upload="));\n      Serial.println(uploaded ? F("ok") : F("deferred/lost"));\n      continue;\n    }`;

  const newObservationConsumer = `    if (event.type == MDB_EVENT_SELECTION_OBSERVATION) {\n      String selectionText = mdbSelectionText(event.selection);\n      JsonDocument doc;\n      addCommonPayload(doc, "selection_observation");\n      doc["interface"] = "mdb";\n      doc["selection_code"] = selectionText;\n      doc["item_number"] = event.selection;\n      doc["price_minor"] = event.priceCents;\n      doc["currency"] = "ZAR";\n      doc["result"] = mdbSelectionObservationStageName(event.observationStage);\n      doc["source"] = "mdb";\n      doc["confirmation"] = event.observationStage == MDB_SELECTION_REQUESTED ? "vend_request" : mdbVendReasonName(event.reason);\n      doc["confidence"] = mdbSelectionObservationConfidence(event.observationStage);\n      doc["reader_index"] = event.readerIndex;\n      String eventId = event.correlationId != 0\n        ? mdbVendEvidenceKey(event) + ":learn:" + String(event.observationStage)\n        : String(bootId) + ":mdb-selection:" + String(sequenceNumber);\n      doc["event_id"] = eventId;\n\n      bool observationUploaded = sendDocumentToIngest(doc);\n      bool evidenceUploaded = uploadMdbVendEvidence(event);\n      Serial.print(F("MDB learn observation "));\n      Serial.print(mdbSelectionObservationStageName(event.observationStage));\n      Serial.print(F(" selection="));\n      Serial.print(selectionText);\n      Serial.print(F(" learn="));\n      Serial.print(observationUploaded ? F("ok") : F("deferred/lost"));\n      Serial.print(F(" evidence="));\n      Serial.println(evidenceUploaded ? F("ok") : F("deferred/lost"));\n      continue;\n    }`;
  source = replaceOnce(source, oldObservationConsumer, newObservationConsumer, 'MDB learn/evidence event consumer');

  source = replaceOnce(
    source,
    `      cashless.vendPending = true;\n      cashless.vendApproved = false;\n      cashless.vendStartedMs = millis();\n      uint32_t requestedCents = mdbScaledToCents(cashless.requestedScaledPrice, cashless.scaleFactor, cashless.decimalPlaces);\n      mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), cashless.selection, requestedCents, MDB_SELECTION_REQUESTED, "mdb");\n      break;`,
    `      cashless.vendPending = true;\n      cashless.vendApproved = false;\n      cashless.vendStartedMs = millis();\n      cashless.vendCorrelationId = mdbNextVendCorrelationId();\n      cashless.vendCorrelationOrdinal = 0;\n      uint32_t requestedCents = mdbScaledToCents(cashless.requestedScaledPrice, cashless.scaleFactor, cashless.decimalPlaces);\n      mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), cashless.selection, requestedCents, MDB_SELECTION_REQUESTED, "mdb", cashless.vendCorrelationId, cashless.vendCorrelationOrdinal);\n      break;`,
    'MDB vend request correlation assignment',
  );

  source = replaceOnce(
    source,
    `    case 0x01: // VEND CANCEL\n      cashless.vendPending = false;\n      cashless.vendApproved = false;\n      cashless.selection = 0xFFFF;\n      cashless.requestedScaledPrice = 0;\n      cashless.approvedScaledPrice = 0;\n      break;`,
    `    case 0x01: // VEND CANCEL\n      cashless.vendPending = false;\n      cashless.vendApproved = false;\n      cashless.selection = 0xFFFF;\n      cashless.requestedScaledPrice = 0;\n      cashless.approvedScaledPrice = 0;\n      cashless.vendCorrelationId = 0;\n      cashless.vendCorrelationOrdinal = 0;\n      break;`,
    'MDB vend cancel correlation reset',
  );

  source = replaceOnce(
    source,
    `      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);\n      if (cashless.vendPending || selection != 0xFFFF) {\n        mdbRecordVend(selection, cents, true,\n                      basketEnabled ? "cashless_basket_vend_success" : "cashless_vend_success");\n      }\n\n      // Basket mode can emit multiple SUCCESS/FAILURE commands after one\n      // VEND REQUEST. Keep the transaction context only while items remain.\n      cashless.vendPending = basketEnabled && remainingItems > 0;\n      cashless.vendApproved = cashless.vendPending;\n      if (!cashless.vendPending) {\n        cashless.selection = 0xFFFF;\n        cashless.requestedScaledPrice = 0;\n        cashless.approvedScaledPrice = 0;\n      }`,
    `      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);\n      if (cashless.vendPending || selection != 0xFFFF) {\n        const char* reason = basketEnabled ? "cashless_basket_vend_success" : "cashless_vend_success";\n        if (mdbRecordVend(selection, cents, true, reason)) {\n          mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), selection, cents,\n            MDB_SELECTION_SUCCESS, reason, cashless.vendCorrelationId, cashless.vendCorrelationOrdinal);\n        }\n      }\n\n      // Basket mode can emit multiple SUCCESS/FAILURE commands after one\n      // VEND REQUEST. The first terminal result keeps the request/approval key;\n      // later basket items receive a deterministic ordinal suffix.\n      cashless.vendPending = basketEnabled && remainingItems > 0;\n      cashless.vendApproved = cashless.vendPending;\n      if (cashless.vendPending) {\n        cashless.vendCorrelationOrdinal++;\n      } else {\n        cashless.selection = 0xFFFF;\n        cashless.requestedScaledPrice = 0;\n        cashless.approvedScaledPrice = 0;\n        cashless.vendCorrelationId = 0;\n        cashless.vendCorrelationOrdinal = 0;\n      }`,
    'MDB vend success evidence',
  );

  source = replaceOnce(
    source,
    `      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);\n      if (cashless.vendPending || (basketEnabled && selection != 0xFFFF)) {\n        mdbRecordVend(selection, cents, false,\n                      basketEnabled ? "cashless_basket_vend_failure" : "cashless_vend_failure");\n      }\n\n      cashless.vendPending = basketEnabled && remainingItems > 0;\n      cashless.vendApproved = cashless.vendPending;\n      if (!cashless.vendPending) {\n        cashless.selection = 0xFFFF;\n        cashless.requestedScaledPrice = 0;\n        cashless.approvedScaledPrice = 0;\n      }`,
    `      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);\n      if (cashless.vendPending || (basketEnabled && selection != 0xFFFF)) {\n        const char* reason = basketEnabled ? "cashless_basket_vend_failure" : "cashless_vend_failure";\n        if (mdbRecordVend(selection, cents, false, reason)) {\n          mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), selection, cents,\n            MDB_SELECTION_FAILURE, reason, cashless.vendCorrelationId, cashless.vendCorrelationOrdinal);\n        }\n      }\n\n      cashless.vendPending = basketEnabled && remainingItems > 0;\n      cashless.vendApproved = cashless.vendPending;\n      if (cashless.vendPending) {\n        cashless.vendCorrelationOrdinal++;\n      } else {\n        cashless.selection = 0xFFFF;\n        cashless.requestedScaledPrice = 0;\n        cashless.approvedScaledPrice = 0;\n        cashless.vendCorrelationId = 0;\n        cashless.vendCorrelationOrdinal = 0;\n      }`,
    'MDB vend failure evidence',
  );

  source = replaceOnce(
    source,
    `    case 0x04: // SESSION COMPLETE\n      cashless.vendPending = false;\n      cashless.vendApproved = false;\n      cashless.selection = 0xFFFF;\n      cashless.requestedScaledPrice = 0;\n      cashless.approvedScaledPrice = 0;\n      break;`,
    `    case 0x04: // SESSION COMPLETE\n      cashless.vendPending = false;\n      cashless.vendApproved = false;\n      cashless.selection = 0xFFFF;\n      cashless.requestedScaledPrice = 0;\n      cashless.approvedScaledPrice = 0;\n      cashless.vendCorrelationId = 0;\n      cashless.vendCorrelationOrdinal = 0;\n      break;`,
    'MDB session complete correlation reset',
  );

  source = replaceOnce(
    source,
    `      if (freeVend) {\n        // A free vend is a successful physical dispense with zero revenue.\n        // Count the unit but do not create artificial sales value.\n        mdbRecordVend(selection, 0, true, "free_vend");`,
    `      if (freeVend) {\n        // A free vend is a successful physical dispense with zero revenue.\n        // Count the unit but do not create artificial sales value.\n        uint32_t auditCorrelationId = mdbNextVendCorrelationId();\n        if (mdbRecordVend(selection, 0, true, "free_vend")) {\n          mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), selection, 0,\n            MDB_SELECTION_SUCCESS, "free_vend", auditCorrelationId, 0);\n        }`,
    'MDB free vend evidence',
  );

  source = replaceOnce(
    source,
    `      } else {\n        // Existing paid/cash audit behaviour remains unchanged.\n        mdbRecordVend(selection, cents, true, "cash_sale");\n      }`,
    `      } else {\n        // Existing paid/cash audit accounting remains unchanged; evidence is\n        // correlated independently so audit notifications cannot double-count.\n        uint32_t auditCorrelationId = mdbNextVendCorrelationId();\n        if (mdbRecordVend(selection, cents, true, "cash_sale")) {\n          mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), selection, cents,\n            MDB_SELECTION_SUCCESS, "cash_sale", auditCorrelationId, 0);\n        }\n      }`,
    'MDB cash sale evidence',
  );

  source = replaceOnce(
    source,
    `      mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), cashless.selection,\n        mdbScaledToCents(cashless.approvedScaledPrice ? cashless.approvedScaledPrice : cashless.requestedScaledPrice, cashless.scaleFactor, cashless.decimalPlaces),\n        MDB_SELECTION_APPROVED, "mdb");`,
    `      mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), cashless.selection,\n        mdbScaledToCents(cashless.approvedScaledPrice ? cashless.approvedScaledPrice : cashless.requestedScaledPrice, cashless.scaleFactor, cashless.decimalPlaces),\n        MDB_SELECTION_APPROVED, "mdb", cashless.vendCorrelationId, cashless.vendCorrelationOrdinal);`,
    'MDB approval correlation',
  );

  source = replaceOnce(
    source,
    `    case 0x06: // VEND DENIED\n      mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), cashless.selection,\n        mdbScaledToCents(cashless.requestedScaledPrice, cashless.scaleFactor, cashless.decimalPlaces),\n        MDB_SELECTION_DENIED, "cashless_vend_failure");\n      cashless.vendApproved = false;\n      cashless.vendPending = false;\n      cashless.selection = 0xFFFF;\n      cashless.requestedScaledPrice = 0;\n      cashless.approvedScaledPrice = 0;\n      break;`,
    `    case 0x06: // VEND DENIED\n      mdbRecordSelectionObservation(static_cast<uint8_t>(cashlessIdx), cashless.selection,\n        mdbScaledToCents(cashless.requestedScaledPrice, cashless.scaleFactor, cashless.decimalPlaces),\n        MDB_SELECTION_DENIED, "cashless_vend_failure", cashless.vendCorrelationId, cashless.vendCorrelationOrdinal);\n      cashless.vendApproved = false;\n      cashless.vendPending = false;\n      cashless.selection = 0xFFFF;\n      cashless.requestedScaledPrice = 0;\n      cashless.approvedScaledPrice = 0;\n      cashless.vendCorrelationId = 0;\n      cashless.vendCorrelationOrdinal = 0;\n      break;`,
    'MDB denial correlation and reset',
  );

  source = replaceOnce(
    source,
    `    case 0x00: // JUST RESET\n      cashless.vendPending = false;\n      cashless.vendApproved = false;\n      cashless.selection = 0xFFFF;\n      cashless.requestedScaledPrice = 0;\n      cashless.approvedScaledPrice = 0;\n      cashless.enabledFeatureBits = 0;`,
    `    case 0x00: // JUST RESET\n      cashless.vendPending = false;\n      cashless.vendApproved = false;\n      cashless.selection = 0xFFFF;\n      cashless.requestedScaledPrice = 0;\n      cashless.approvedScaledPrice = 0;\n      cashless.vendCorrelationId = 0;\n      cashless.vendCorrelationOrdinal = 0;\n      cashless.enabledFeatureBits = 0;`,
    'MDB reader reset correlation reset',
  );

  source = replaceOnce(
    source,
    `    case 0x07: // END SESSION\n    case 0x08: // CANCELLED\n      cashless.vendPending = false;\n      cashless.vendApproved = false;\n      cashless.selection = 0xFFFF;\n      cashless.requestedScaledPrice = 0;\n      cashless.approvedScaledPrice = 0;\n      break;`,
    `    case 0x07: // END SESSION\n    case 0x08: // CANCELLED\n      cashless.vendPending = false;\n      cashless.vendApproved = false;\n      cashless.selection = 0xFFFF;\n      cashless.requestedScaledPrice = 0;\n      cashless.approvedScaledPrice = 0;\n      cashless.vendCorrelationId = 0;\n      cashless.vendCorrelationOrdinal = 0;\n      break;`,
    'MDB end/cancel correlation reset',
  );

  source = replaceOnce(
    source,
    '  Serial.println(F("MDB is native/passive on ESP32-S3 RMT. GPIO4/GPIO5 remain input-only; Learn Mode observes selection IDs and never transmits onto MDB."));',
    '  Serial.println(F("MDB is native/passive on ESP32-S3 RMT. GPIO4/GPIO5 remain input-only; Learn Mode and vend evidence are decoded passively and never transmit onto MDB."));',
    'MDB help vend-evidence output',
  );

  if (!source.includes('"vend_evidence"') || !source.includes('mdbVendEvidenceKey')) {
    throw new Error('Generated V6.8.50 is missing MDB vend evidence emission.');
  }
  if (!source.includes('vendCorrelationId') || !source.includes('vendCorrelationOrdinal')) {
    throw new Error('Generated V6.8.50 is missing stable vend correlation state.');
  }
  if (!/DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/.test(source)) {
    throw new Error('Generated V6.8.50 must retain passive-only MDB TX safety.');
  }
  if (source.includes('static const char* FIRMWARE_VERSION = "6.8.49-')) {
    throw new Error('Generated V6.8.50 still reports the V6.8.49 firmware version.');
  }
  return source;
}

export async function generateTelemetryV650(outputPath = defaultOutputPath) {
  const source = await readFile(sourcePath, 'utf8');
  const generated = transformTelemetryV650(source);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  return outputPath;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const output = process.env.DALLMAYR_V650_OUTPUT ? path.resolve(process.env.DALLMAYR_V650_OUTPUT) : defaultOutputPath;
  await generateTelemetryV650(output);
  console.log(`Generated ${path.relative(root, output)} with passive MDB vend evidence and correlated Learn Mode.`);
}
