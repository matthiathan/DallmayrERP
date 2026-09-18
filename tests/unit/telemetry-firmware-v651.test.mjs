import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformTelemetryV651 } from '../../scripts/generate-telemetry-v6-8-51.mjs';

const baseFirmware = fs.readFileSync(
  new URL('../../firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino', import.meta.url),
  'utf8',
);

const generated = transformTelemetryV651(baseFirmware);

test('V6.8.51 keeps passive MDB safety while adding DEX audit reconciliation', () => {
  assert.match(generated, /6\.8\.51-esp32s3-air780eu-mdb-vend-dex-audit/);
  assert.match(generated, /DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/);
  assert.match(generated, /addCommonPayload\(doc, "dex_audit_snapshot"\)/);
  assert.match(generated, /counter_semantics.*cumulative_dex_product_audit/);
});

test('passive MDB profile fingerprint is stable across cashless-reader serial replacements', () => {
  const fingerprintBuilder = generated.match(/void updateMdbProfileFingerprint\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(fingerprintBuilder, /String fingerprint = String\("MDB2-"\)/);
  assert.match(fingerprintBuilder, /reader\.manufacturer/);
  assert.match(fingerprintBuilder, /reader\.modelNumber/);
  assert.match(fingerprintBuilder, /reader\.softwareVersion/);
  assert.doesNotMatch(fingerprintBuilder, /seed \+= String\(reader\.peripheralSerial\)/);
});

test('current DEX PA2 and aggregate VA1 counters are captured into the reconciliation buffer', () => {
  assert.match(
    generated,
    /setCumulativeCounter\(currentSelection, sold, revenue, currentPriceCents, currentProduct\);\s*rememberDexAuditUploadItem\(currentSelection, currentProduct, currentPriceCents, sold, revenue\);/s,
  );
  assert.match(
    generated,
    /setCumulativeCounter\("TOTAL", sold, revenue, 0, "Machine total"\);\s*rememberDexAuditUploadItem\("TOTAL", "Machine total", 0, sold, revenue\);/s,
  );
});

test('completed DEX audit uploads authoritative counters before secondary audit evidence', () => {
  const dexUploadBranch = generated.match(
    /if \(machineInterface == IFACE_DEX\) \{[\s\S]*?\} else if \(!uploadAllCounters\(\)\)/,
  )?.[0] ?? '';

  assert.match(dexUploadBranch, /if \(dexAuditSnapshotPending\)/);
  assert.match(dexUploadBranch, /uploadAllCounters\(\)/);
  assert.match(dexUploadBranch, /uploadDexAuditSnapshot\(\)/);
  assert.ok(
    dexUploadBranch.indexOf('uploadAllCounters()') < dexUploadBranch.indexOf('uploadDexAuditSnapshot()'),
    'counter accounting must upload before secondary DEX reconciliation evidence',
  );
});

test('failed DEX evidence upload retains the completed audit instead of requesting a newer audit', () => {
  assert.match(generated, /DEX reconciliation snapshot upload failed; retaining completed audit/);
  assert.match(generated, /counterUploadRequested = true;/);
  assert.match(
    generated,
    /if \(dexAuditSnapshotPending\) \{\s*Serial\.println\(F\("DEX audit upload is still pending; current audit will be retried before another machine read\."\)\);\s*return;/s,
  );
});

test('DEX reconciliation payloads are cumulative snapshots and never increment local vend counters', () => {
  const uploader = generated.match(/bool uploadDexAuditSnapshot\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(uploader, /sold_total/);
  assert.match(uploader, /revenue_cents_total/);
  assert.match(uploader, /sendDocumentToIngest\(doc\)/);
  assert.doesNotMatch(uploader, /incrementLocalVend/);
  assert.doesNotMatch(uploader, /soldTotal\+\+/);
});

test('DEX reconciliation buffer overflow withholds secondary evidence without blocking production counters', () => {
  assert.match(generated, /DEX_AUDIT_UPLOAD_CAPACITY = 96/);
  assert.match(generated, /DEX_AUDIT_ITEM_OVERFLOW/);
  assert.match(generated, /production counters remain available but secondary audit evidence is withheld/);
  assert.match(generated, /dexAuditSnapshotPending = false/);
});
