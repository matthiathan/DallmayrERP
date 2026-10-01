import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const factoryMigration = fs.readFileSync(
  new URL('../../supabase/migrations/20261001070000_factory_zero_touch_enrollment.sql', import.meta.url),
  'utf8',
);
const identityMigration = fs.readFileSync(
  new URL('../../supabase/migrations/20261001070500_bootstrap_device_identity.sql', import.meta.url),
  'utf8',
);
const enrollFunction = fs.readFileSync(
  new URL('../../supabase/functions/telemetry-enroll/index.ts', import.meta.url),
  'utf8',
);

test('factory claims store only a hashed one-time bootstrap credential and are service-role only', () => {
  assert.match(factoryMigration, /bootstrap_token_hash text not null/);
  assert.doesNotMatch(factoryMigration, /bootstrap_token text not null/);
  assert.match(factoryMigration, /hardware_uid text not null unique/);
  assert.match(factoryMigration, /status text not null default 'ready'/);
  assert.match(factoryMigration, /alter table public\.telemetry_factory_device_claims enable row level security/);
  assert.match(factoryMigration, /revoke all on public\.telemetry_factory_device_claims from public, anon, authenticated/);
  assert.match(factoryMigration, /grant all on public\.telemetry_factory_device_claims to service_role/);
});

test('factory enrollment atomically binds one authorized hardware UID and consumes its claim', () => {
  assert.match(factoryMigration, /where hardware_uid = v_hardware_uid[\s\S]*bootstrap_token_hash = lower\(p_bootstrap_token_hash\)[\s\S]*status = 'ready'[\s\S]*for update/);
  assert.match(factoryMigration, /if exists \(select 1 from public\.telemetry_devices where hardware_uid = v_hardware_uid\)/);
  assert.match(factoryMigration, /set status = 'claimed',[\s\S]*claimed_device_id = v_device_id,[\s\S]*claimed_at = now\(\)/);
  assert.match(factoryMigration, /grant execute on function public\.enroll_telemetry_device_factory[\s\S]*to service_role/);
  assert.match(factoryMigration, /revoke all on function public\.enroll_telemetry_device_factory[\s\S]*from public, anon, authenticated/);
});

test('factory enrollment uses region-bound exact serial evidence and never location alone for an exact machine link', () => {
  assert.match(factoryMigration, /where telemetry_region = v_claim\.telemetry_region/);
  assert.match(factoryMigration, /lower\(trim\(serial_number\)\) = v_serial/);
  assert.match(factoryMigration, /if v_matches = 1 then/);
  assert.doesNotMatch(factoryMigration, /latitude[\s\S]*v_machine_id/);
  assert.doesNotMatch(factoryMigration, /longitude[\s\S]*v_machine_id/);
});

test('enrollment edge function hashes the factory secret before the service-role RPC and keeps manual fallbacks', () => {
  assert.match(enrollFunction, /const factoryBootstrapToken = String\(payload\.factory_bootstrap_token/);
  assert.match(enrollFunction, /enroll_telemetry_device_factory'/);
  assert.match(enrollFunction, /p_bootstrap_token_hash: await sha256Hex\(factoryBootstrapToken\)/);
  assert.doesNotMatch(enrollFunction, /p_bootstrap_token:\s*factoryBootstrapToken/);
  assert.match(enrollFunction, /enroll_telemetry_device'/);
  assert.match(enrollFunction, /enroll_telemetry_device_zero_touch'/);
});

test('first contact can persist modem identity and canonical location without making location mandatory', () => {
  assert.match(identityMigration, /add column if not exists modem_imei text/);
  assert.match(identityMigration, /add column if not exists sim_iccid text/);
  assert.match(enrollFunction, /modem_imei/);
  assert.match(enrollFunction, /sim_iccid/);
  assert.match(enrollFunction, /record_telemetry_device_location/);
  assert.match(enrollFunction, /if \(enrolledDeviceId && location\)/);
  assert.match(enrollFunction, /first_location: locationResult/);
});
