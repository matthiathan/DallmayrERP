import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformTelemetryV650 } from '../../scripts/generate-telemetry-v6-8-50.mjs';

const baseFirmware = fs.readFileSync(
  new URL('../../firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino', import.meta.url),
  'utf8',
);

const generated = transformTelemetryV650(baseFirmware);

test('V6.8.50 remains passive MDB while emitting vend evidence from decoded lifecycle states', () => {
  assert.match(generated, /6\.8\.50-esp32s3-air780eu-passive-mdb-vend-evidence/);
  assert.match(generated, /DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/);
  assert.match(generated, /addCommonPayload\(doc, "vend_evidence"\)/);
  assert.match(generated, /"vend_request"/);
  assert.match(generated, /"vend_approved"/);
  assert.match(generated, /"vend_denied"/);
  assert.match(generated, /"vend_success"/);
  assert.match(generated, /"vend_failure"/);
  assert.match(generated, /"cash_sale"/);
  assert.match(generated, /counter_accounting.*separate_cumulative_snapshot/);
});

test('one decoded cashless vend carries one stable correlation from request through terminal result', () => {
  assert.match(generated, /vendCorrelationId = mdbNextVendCorrelationId\(\)/);
  assert.match(generated, /vendCorrelationOrdinal = 0/);
  assert.match(generated, /MDB_SELECTION_REQUESTED[\s\S]*cashless\.vendCorrelationId[\s\S]*cashless\.vendCorrelationOrdinal/);
  assert.match(generated, /MDB_SELECTION_APPROVED[\s\S]*cashless\.vendCorrelationId[\s\S]*cashless\.vendCorrelationOrdinal/);
  assert.match(generated, /MDB_SELECTION_DENIED[\s\S]*cashless\.vendCorrelationId[\s\S]*cashless\.vendCorrelationOrdinal/);
  assert.match(generated, /MDB_SELECTION_SUCCESS[\s\S]*cashless\.vendCorrelationId[\s\S]*cashless\.vendCorrelationOrdinal/);
  assert.match(generated, /MDB_SELECTION_FAILURE[\s\S]*cashless\.vendCorrelationId[\s\S]*cashless\.vendCorrelationOrdinal/);
  assert.match(generated, /doc\["vend_key"\] = mdbVendEvidenceKey\(event\)/);
});

test('basket results advance a correlation ordinal so legitimate multiple items are not idempotency-collapsed', () => {
  const ordinalIncrements = generated.match(/vendCorrelationOrdinal\+\+/g) ?? [];
  assert.ok(ordinalIncrements.length >= 2, 'success and failure basket paths must both advance the ordinal');
  assert.match(generated, /if \(event\.correlationOrdinal > 0\) key \+=/);
});

test('counter accounting remains separate from vend evidence transport', () => {
  assert.match(generated, /if \(event\.type == MDB_EVENT_VEND\)[\s\S]*incrementLocalVend\(selectionText, event\.priceCents, event\.success\)/);
  const evidenceUploader = generated.match(/bool uploadMdbVendEvidence[\s\S]*?\n}/)?.[0] ?? '';
  assert.match(evidenceUploader, /sendDocumentToIngest\(doc\)/);
  assert.doesNotMatch(evidenceUploader, /incrementLocalVend/);
  assert.doesNotMatch(evidenceUploader, /soldTotal/);
  assert.doesNotMatch(evidenceUploader, /failedTotal/);
});

test('undefined MDB item numbers never become product-level vend evidence', () => {
  assert.match(generated, /if \(event\.correlationId == 0 \|\| event\.selection == 0xFFFF\) return false/);
  assert.match(generated, /MDB selection observation skipped: item number is undefined \(FFFF\)/);
});

test('cash and free-vend audit notifications use independent completed correlations', () => {
  const auditIds = generated.match(/auditCorrelationId = mdbNextVendCorrelationId\(\)/g) ?? [];
  assert.ok(auditIds.length >= 2, 'free vend and paid cash sale each need an independent audit correlation');
  assert.match(generated, /MDB_SELECTION_SUCCESS, "free_vend", auditCorrelationId, 0/);
  assert.match(generated, /MDB_SELECTION_SUCCESS, "cash_sale", auditCorrelationId, 0/);
});
