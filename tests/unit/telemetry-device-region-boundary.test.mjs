import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8') }));

test('device-management security-definer RPCs enforce the selected telemetry region', () => {
  const hardening = migrations.find(({ name }) => name.endsWith('_harden_device_region_boundaries.sql'));
  assert.ok(hardening, 'A dedicated device region-boundary hardening migration must exist');

  const sql = hardening.content;
  for (const functionName of [
    'search_machine_assets',
    'save_telemetry_device_configuration',
    'request_telemetry_prepaid_balance',
    'delete_telemetry_device',
  ]) {
    const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\s*\\([\\s\\S]*?(?=create\\s+or\\s+replace\\s+function\\s+public\\.|$)`, 'i'));
    assert.ok(match, `${functionName} must be redefined by the hardening migration`);
    assert.match(match[0], /assert_telemetry_region_selected\s*\(/i, `${functionName} must require a selected telemetry region`);
    assert.match(match[0], /telemetry_region\s*=\s*v_region|telemetry_region\s*=\s*public\.assert_telemetry_region_selected\s*\(/i, `${functionName} must scope its target rows to that region`);
  }
});

test('privileged device mutations preserve authenticated-only execution grants', () => {
  const hardening = migrations.find(({ name }) => name.endsWith('_harden_device_region_boundaries.sql'));
  assert.ok(hardening);

  for (const signature of [
    'search_machine_assets(text, text, text, boolean, integer, integer)',
    'save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer)',
    'request_telemetry_prepaid_balance(text)',
    'delete_telemetry_device(uuid, text)',
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(hardening.content, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${escaped}\\s+from\\s+public,\\s*anon`, 'i'));
    assert.match(hardening.content, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${escaped}\\s+to\\s+authenticated,\\s*service_role`, 'i'));
  }
});
