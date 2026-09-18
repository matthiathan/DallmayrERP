import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migrationsDir = path.resolve('supabase/migrations');
const suffix = '_retire_legacy_device_control_rpcs.sql';

function migrationText() {
  const file = fs.readdirSync(migrationsDir).find((name) => name.endsWith(suffix));
  assert.ok(file, 'A dedicated migration must retire the legacy device-control RPCs');
  return fs.readFileSync(path.join(migrationsDir, file), 'utf8').toLowerCase();
}

const legacyFunctions = [
  'set_telemetry_device_control(text, text, boolean, boolean)',
  'set_telemetry_device_location_control(text, boolean, integer, integer)',
  'set_telemetry_device_mode(text, text)',
  'set_telemetry_prepaid_balance_control(text, integer, integer, integer, integer)',
];

test('legacy security-definer device control RPCs are no longer executable by authenticated users', () => {
  const sql = migrationText();
  for (const signature of legacyFunctions) {
    assert.match(
      sql,
      new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${signature.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s+from\\s+authenticated`),
      `${signature} must revoke authenticated execution`,
    );
  }
});

test('retired device control RPCs remain available only to the service role for maintenance compatibility', () => {
  const sql = migrationText();
  for (const signature of legacyFunctions) {
    assert.match(
      sql,
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s+to\\s+service_role`),
      `${signature} must retain service-role execution`,
    );
  }
});
