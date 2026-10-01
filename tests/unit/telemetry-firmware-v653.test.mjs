import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformTelemetryV653 } from '../../scripts/generate-telemetry-v6-8-53.mjs';

const baseFirmware = fs.readFileSync(
  new URL('../../firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino', import.meta.url),
  'utf8',
);

const generated = transformTelemetryV653(baseFirmware);

test('V6.8.53 keeps passive MDB safety while adding factory zero-touch enrollment', () => {
  assert.match(generated, /6\.8\.53-esp32s3-air780eu-factory-zero-touch/);
  assert.match(generated, /DALLMAYR_MDB_ACTIVE_TX_ENABLED\s+false/);
  assert.match(generated, /#define DALLMAYR_FACTORY_BOOTSTRAP_TOKEN ""/);
  assert.match(generated, /factoryBootstrapToken = prefs\.getString\("factory_token"/);
  assert.match(generated, /doc\["factory_bootstrap_token"\] = factoryBootstrapToken/);
});

test('V6.8.53 keeps one-time enrollment tokens authoritative over factory bootstrap', () => {
  const enrollmentPayload = generated.match(/bool enrollIfNeeded\(bool forceAttempt = false\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(enrollmentPayload, /if \(enrollmentToken\.length\(\)\) doc\["enrollment_token"\] = enrollmentToken/);
  assert.match(enrollmentPayload, /else if \(factoryBootstrapToken\.length\(\)\) doc\["factory_bootstrap_token"\] = factoryBootstrapToken/);
});

test('V6.8.53 captures modem and SIM identity in the first enrollment payload', () => {
  assert.match(generated, /AT\+CGSN/);
  assert.match(generated, /AT\+CCID/);
  assert.match(generated, /doc\["modem_imei"\] = modemImei/);
  assert.match(generated, /doc\["sim_iccid"\] = simIccid/);
  assert.match(generated, /doc\["cellular_operator"\] = cellularOperator/);
  assert.match(generated, /doc\["cellular_model"\] = cellularModel/);
});

test('V6.8.53 attempts best-effort cellular LBS on isolated bearer 3 and never blocks enrollment when unavailable', () => {
  const lbs = generated.match(/bool readCellularLbsFix\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(lbs, /AT\+SAPBR=3,3/);
  assert.match(lbs, /AT\+SAPBR=1,3/);
  assert.match(lbs, /AT\+CIPGSMLOC=1,3/);
  assert.match(lbs, /AT\+SAPBR=0,3/);
  assert.doesNotMatch(lbs, /AT\+SAPBR=[013],1/);
  assert.match(generated, /Cellular LBS first fix unavailable; enrollment will continue without inventing a location/);
});

test('V6.8.53 preserves stable profile identity and DEX reconciliation behavior', () => {
  assert.match(generated, /String fingerprint = String\("MDB2-"\)/);
  assert.match(generated, /acceptMachineIdentityDetails\(serial, model, revision, location, asset, "dex_id1"\)/);
  assert.match(generated, /addCommonPayload\(doc, "dex_audit_snapshot"\)/);
  assert.doesNotMatch(generated, /reportedMachineSerial\s*=\s*String\(reader\.peripheralSerial\)/);
});
