import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformTelemetryV652 } from '../../scripts/generate-telemetry-v6-8-52.mjs';

const baseFirmware = fs.readFileSync(
  new URL('../../firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino', import.meta.url),
  'utf8',
);

const generated = transformTelemetryV652(baseFirmware);

test('V6.8.52 publishes the stable MDB profile fingerprint schema without changing passive safety', () => {
  assert.match(generated, /6\.8\.52-esp32s3-air780eu-stable-mdb-profile-fingerprint/);
  assert.match(generated, /DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/);
  assert.match(generated, /String fingerprint = String\("MDB2-"\)/);
});

test('V6.8.52 profile signature keeps reusable reader capabilities but excludes the unique reader serial', () => {
  const fingerprintBuilder = generated.match(/void updateMdbProfileFingerprint\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(fingerprintBuilder, /reader\.manufacturer/);
  assert.match(fingerprintBuilder, /reader\.modelNumber/);
  assert.match(fingerprintBuilder, /reader\.softwareVersion/);
  assert.match(fingerprintBuilder, /reader\.supportedFeatureBits/);
  assert.match(fingerprintBuilder, /reader\.enabledFeatureBits/);
  assert.doesNotMatch(fingerprintBuilder, /seed \+= String\(reader\.peripheralSerial\)/);
});

test('V6.8.52 retains exact DEX identity and DEX reconciliation behavior', () => {
  assert.match(generated, /acceptMachineIdentityDetails\(serial, model, revision, location, asset, "dex_id1"\)/);
  assert.match(generated, /addCommonPayload\(doc, "dex_audit_snapshot"\)/);
  assert.match(generated, /counter_semantics.*cumulative_dex_product_audit/);
});

test('MDB remains profile evidence only and never becomes an invented machine serial', () => {
  assert.match(generated, /machineIdentitySource = "mdb_bus_signature"/);
  assert.match(generated, /MDB signature is profile evidence only; standard MDB does not guarantee the VMC serial/);
  assert.doesNotMatch(generated, /reportedMachineSerial\s*=\s*String\(reader\.peripheralSerial\)/);
});
