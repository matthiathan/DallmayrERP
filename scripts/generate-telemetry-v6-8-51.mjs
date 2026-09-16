import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformTelemetryV650 } from './generate-telemetry-v6-8-50.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino');
const defaultOutputPath = path.join(root, 'firmware/DallmayrTelemetryV6_8_51/DallmayrTelemetryV6_8_51.ino');

function replaceOnce(source, needle, replacement, label = needle.slice(0, 80)) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`V6.8.51 generator could not find ${label}.`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`V6.8.51 generator expected exactly one ${label}.`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

export function transformTelemetryV651(input) {
  let source = transformTelemetryV650(input);

  source = source
    .replace(
      'Dallmayr South Africa - Telemetry V6.8.50 PASSIVE MDB VEND EVIDENCE + SELECTION LEARN MODE + DEX',
      'Dallmayr South Africa - Telemetry V6.8.51 PASSIVE MDB VEND EVIDENCE + DEX AUDIT RECONCILIATION',
    )
    .replace(
      'static const char* FIRMWARE_VERSION = "6.8.50-esp32s3-air780eu-passive-mdb-vend-evidence";',
      'static const char* FIRMWARE_VERSION = "6.8.51-esp32s3-air780eu-mdb-vend-dex-audit";',
    );

  source = replaceOnce(
    source,
    `void appendDexByte(uint8_t b) {`,
    `static const uint8_t DEX_AUDIT_UPLOAD_CAPACITY = 96;\n\nstruct DexAuditUploadItem {\n  char selection[41];\n  char product[97];\n  uint32_t configuredPriceCents;\n  uint64_t soldTotal;\n  uint64_t revenueCentsTotal;\n};\n\nstatic DexAuditUploadItem dexAuditUploadItems[DEX_AUDIT_UPLOAD_CAPACITY];\nstatic uint8_t dexAuditUploadItemCount = 0;\nstatic bool dexAuditUploadOverflow = false;\nstatic bool dexAuditSnapshotPending = false;\nstatic uint32_t dexAuditCompletedMs = 0;\n\nvoid resetDexAuditUploadBuffer() {\n  dexAuditUploadItemCount = 0;\n  dexAuditUploadOverflow = false;\n}\n\nvoid rememberDexAuditUploadItem(const String& selection, const String& product,\n                                uint32_t configuredPriceCents, uint64_t soldTotal,\n                                uint64_t revenueCentsTotal) {\n  if (!selection.length()) return;\n  if (dexAuditUploadItemCount >= DEX_AUDIT_UPLOAD_CAPACITY) {\n    dexAuditUploadOverflow = true;\n    return;\n  }\n\n  DexAuditUploadItem& item = dexAuditUploadItems[dexAuditUploadItemCount++];\n  memset(&item, 0, sizeof(item));\n  copyText(item.selection, sizeof(item.selection), selection);\n  if (product.length()) copyText(item.product, sizeof(item.product), product);\n  item.configuredPriceCents = configuredPriceCents;\n  item.soldTotal = soldTotal;\n  item.revenueCentsTotal = revenueCentsTotal;\n}\n\nbool uploadDexAuditSnapshot() {\n  if (!dexAuditSnapshotPending || dexAuditUploadItemCount == 0) return true;\n  if (dexAuditUploadOverflow) return false;\n\n  uint8_t index = 0;\n  while (index < dexAuditUploadItemCount) {\n    JsonDocument doc;\n    addCommonPayload(doc, "dex_audit_snapshot");\n    doc["audit_completed_uptime_ms"] = dexAuditCompletedMs;\n    doc["counter_semantics"] = "cumulative_dex_product_audit";\n    JsonArray items = doc["items"].to<JsonArray>();\n\n    uint8_t added = 0;\n    while (index < dexAuditUploadItemCount && added < MAX_ITEMS_PER_UPLOAD) {\n      const DexAuditUploadItem& item = dexAuditUploadItems[index++];\n      JsonObject out = items.add<JsonObject>();\n      out["selection"] = item.selection;\n      if (strlen(item.product)) out["product"] = item.product;\n      if (item.configuredPriceCents > 0) out["configured_price_cents"] = item.configuredPriceCents;\n      out["sold_total"] = item.soldTotal;\n      out["revenue_cents_total"] = item.revenueCentsTotal;\n      added++;\n    }\n\n    if (!sendDocumentToIngest(doc)) return false;\n  }\n\n  return true;\n}\n\nvoid appendDexByte(uint8_t b) {`,
    'DEX audit upload buffer and sender',
  );

  source = replaceOnce(
    source,
    `void requestDexAudit() {\n  if (machineInterface != IFACE_DEX) return;\n  dexText = "";`,
    `void requestDexAudit() {\n  if (machineInterface != IFACE_DEX) return;\n  if (dexAuditSnapshotPending) {\n    Serial.println(F("DEX audit upload is still pending; current audit will be retried before another machine read."));\n    return;\n  }\n  resetDexAuditUploadBuffer();\n  dexText = "";`,
    'DEX request pending-upload guard',
  );

  source = replaceOnce(
    source,
    `void parseDexText(const String& text) {\n  if (text.length() == 0) return;\n  Serial.print(F("Parsing DEX payload bytes="));`,
    `void parseDexText(const String& text) {\n  if (text.length() == 0) return;\n  resetDexAuditUploadBuffer();\n  Serial.print(F("Parsing DEX payload bytes="));`,
    'DEX parse buffer reset',
  );

  source = replaceOnce(
    source,
    `      uint64_t sold = toUInt64(fieldAt(line, 1));\n      uint64_t revenue = dexValueToCents(toUInt64(fieldAt(line, 2)));\n      setCumulativeCounter(currentSelection, sold, revenue, currentPriceCents, currentProduct);\n      sawProductCounter = true;`,
    `      uint64_t sold = toUInt64(fieldAt(line, 1));\n      uint64_t revenue = dexValueToCents(toUInt64(fieldAt(line, 2)));\n      setCumulativeCounter(currentSelection, sold, revenue, currentPriceCents, currentProduct);\n      rememberDexAuditUploadItem(currentSelection, currentProduct, currentPriceCents, sold, revenue);\n      sawProductCounter = true;`,
    'DEX PA2 cumulative audit capture',
  );

  source = replaceOnce(
    source,
    `      uint64_t revenue = dexValueToCents(toUInt64(fieldAt(line, 1)));\n      uint64_t sold = toUInt64(fieldAt(line, 2));\n      setCumulativeCounter("TOTAL", sold, revenue, 0, "Machine total");\n      continue;`,
    `      uint64_t revenue = dexValueToCents(toUInt64(fieldAt(line, 1)));\n      uint64_t sold = toUInt64(fieldAt(line, 2));\n      setCumulativeCounter("TOTAL", sold, revenue, 0, "Machine total");\n      rememberDexAuditUploadItem("TOTAL", "Machine total", 0, sold, revenue);\n      continue;`,
    'DEX VA1 aggregate audit capture',
  );

  source = replaceOnce(
    source,
    `  if (dexRequestActive) {\n    dexRequestActive = false;\n    if (dexSawDataThisRequest) {\n      setLocalFaultState("DEX_NO_RESPONSE", false, "warning", "dex",\n                         "DEX communication restored", "");\n    }\n  }\n\n  // Counter values are retained locally. Upload timing is controlled by the\n  // effective database telemetry policy in serviceCounterSchedule().`,
    `  if (dexRequestActive) {\n    dexRequestActive = false;\n    if (dexSawDataThisRequest) {\n      setLocalFaultState("DEX_NO_RESPONSE", false, "warning", "dex",\n                         "DEX communication restored", "");\n    }\n  }\n\n  if (dexAuditUploadOverflow) {\n    setLocalFaultState("DEX_AUDIT_ITEM_OVERFLOW", true, "warning", "dex",\n                       "DEX audit exposed more product rows than the reconciliation upload buffer can safely retain; production counters remain available but secondary audit evidence is withheld.", "");\n    dexAuditSnapshotPending = false;\n  } else if (dexAuditUploadItemCount > 0) {\n    setLocalFaultState("DEX_AUDIT_ITEM_OVERFLOW", false, "info", "dex",\n                       "DEX audit reconciliation buffer is within limits", "");\n    dexAuditSnapshotPending = true;\n    dexAuditCompletedMs = millis();\n    counterUploadRequested = true;\n    lastCounterUploadAttemptMs = 0;\n    Serial.print(F("DEX audit ready for counter + reconciliation upload items="));\n    Serial.println(dexAuditUploadItemCount);\n  }\n\n  // Counter values remain the production accounting source. The matching DEX\n  // cumulative snapshot is uploaded only as secondary reconciliation evidence.`,
    'DEX parse completion handoff',
  );

  source = replaceOnce(
    source,
    `    if (machineInterface == IFACE_DEX) {\n      if (!dexRequestActive) requestDexAudit();\n    } else if (!uploadAllCounters()) {\n      Serial.println(F("Counter upload failed; backing off for 30 seconds so config/heartbeat remain serviceable."));\n    }`,
    `    if (machineInterface == IFACE_DEX) {\n      if (dexAuditSnapshotPending) {\n        if (!uploadAllCounters()) {\n          Serial.println(F("DEX counter snapshot upload failed; retaining completed audit for retry."));\n        } else if (!uploadDexAuditSnapshot()) {\n          counterUploadRequested = true;\n          Serial.println(F("DEX reconciliation snapshot upload failed; retaining completed audit and retrying with idempotent cumulative state."));\n        } else {\n          dexAuditSnapshotPending = false;\n          resetDexAuditUploadBuffer();\n          Serial.println(F("DEX counter snapshot and reconciliation snapshot accepted."));\n        }\n      } else if (!dexRequestActive) {\n        requestDexAudit();\n      }\n    } else if (!uploadAllCounters()) {\n      Serial.println(F("Counter upload failed; backing off for 30 seconds so config/heartbeat remain serviceable."));\n    }`,
    'DEX upload orchestration',
  );

  if (!/DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/.test(source)) {
    throw new Error('V6.8.51 safety assertion failed: MDB active TX must remain disabled.');
  }
  if (!source.includes('addCommonPayload(doc, "dex_audit_snapshot")')) {
    throw new Error('V6.8.51 generation failed: DEX audit reconciliation payload missing.');
  }
  if (!source.includes('DEX counter snapshot and reconciliation snapshot accepted.')) {
    throw new Error('V6.8.51 generation failed: DEX completed-audit handoff missing.');
  }

  return source;
}

export async function generateTelemetryV651(outputPath = defaultOutputPath) {
  const source = await readFile(sourcePath, 'utf8');
  const generated = transformTelemetryV651(source);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, 'utf8');
  return outputPath;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outputPath = await generateTelemetryV651();
  console.log(`Generated ${path.relative(root, outputPath)}`);
}
