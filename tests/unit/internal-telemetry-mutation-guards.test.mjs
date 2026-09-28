import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(new URL(name, migrationsUrl), 'utf8'))
  .join('\n');

const guardedFunctions = [
  'delete_telemetry_device',
  'save_telemetry_device_configuration',
  'set_telemetry_device_profile',
  'assign_learned_selection_mapping',
  'copy_machine_model_profile_mappings',
];

test('telemetry mutation RPCs require an active internal Dallmayr account', () => {
  for (const name of guardedFunctions) {
    assert.match(
      migrations,
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?is_active_app_user\\(\\)[\\s\\S]*?is_dallmayr_app_user\\(\\)`, 'i'),
      `${name} must require both active-app-user and Dallmayr-internal authorization`,
    );
  }
});
