import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260928103000_guard_commissioning_alarm_mutations.sql',
  import.meta.url,
);

const guardedFunctions = [
  'open_telemetry_enrollment_window',
  'close_telemetry_enrollment_window',
  'request_telemetry_prepaid_balance',
  'set_telemetry_alarm_workflow',
];

test('commissioning and alarm mutation RPCs require an active internal Dallmayr account', () => {
  assert.equal(
    fs.existsSync(migrationUrl),
    true,
    'dedicated commissioning/alarm mutation guard migration must exist',
  );

  const migration = fs.readFileSync(migrationUrl, 'utf8');

  for (const name of guardedFunctions) {
    assert.match(
      migration,
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, 'i'),
      `${name} must be wrapped by the hardening migration`,
    );
  }

  assert.match(migration, /public\.is_active_app_user\(\)/i);
  assert.match(migration, /public\.is_dallmayr_app_user\(\)/i);
  assert.match(migration, /auth\.jwt\(\)\s*->>\s*'role'[^\n]*service_role/i);
});
