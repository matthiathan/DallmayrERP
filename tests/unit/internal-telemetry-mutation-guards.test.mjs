import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260928100000_guard_internal_telemetry_mutations.sql',
  import.meta.url,
);

const guardedFunctions = [
  'delete_telemetry_device',
  'save_telemetry_device_configuration',
  'set_telemetry_device_profile',
  'assign_learned_selection_mapping',
  'copy_machine_model_profile_mappings',
];

test('telemetry mutation RPCs require an active internal Dallmayr account', () => {
  assert.equal(
    fs.existsSync(migrationUrl),
    true,
    'dedicated telemetry mutation guard migration must exist',
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
