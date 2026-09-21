import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8') }));

function acceptanceMigration() {
  return migrations.find(({ name }) => name.endsWith('_harden_telemetry_field_acceptance_consistency.sql'));
}

test('manual device assignment keeps machine-link metadata and runtime state consistent', () => {
  const migration = acceptanceMigration();
  assert.ok(migration, 'A dedicated field-acceptance consistency migration must exist');

  const body = migration.content.match(/create\s+or\s+replace\s+function\s+public\.save_telemetry_device_configuration\s*\([\s\S]*?(?=create\s+or\s+replace\s+function|revoke\s+all|grant\s+execute|comment\s+on|$)/i)?.[0] ?? '';
  assert.ok(body, 'save_telemetry_device_configuration must be redefined');
  assert.match(body, /machine_link_status\s*=\s*case\s+when\s+p_machine_id\s+is\s+null\s+then\s+'unlinked'\s+else\s+'linked'/i);
  assert.match(body, /machine_link_method\s*=\s*case\s+when\s+p_machine_id\s+is\s+null\s+then\s+null\s+else\s+'manual_assignment'/i);
  assert.match(body, /machine_linked_at\s*=\s*case\s+when\s+p_machine_id\s+is\s+null\s+then\s+null/i);
  assert.match(body, /update\s+public\.telemetry_machine_state[\s\S]*machine_id\s*=\s*p_machine_id[\s\S]*site_id\s*=\s*v_site_id/i);
});

test('existing assigned devices are backfilled to a coherent linked state', () => {
  const migration = acceptanceMigration();
  assert.ok(migration);
  assert.match(migration.content, /update\s+public\.telemetry_devices[\s\S]*machine_link_status\s*=\s*'linked'[\s\S]*machine_link_method\s*=\s*coalesce\s*\(\s*machine_link_method\s*,\s*'manual_assignment'\s*\)[\s\S]*where\s+machine_id\s+is\s+not\s+null/i);
  assert.match(migration.content, /update\s+public\.telemetry_machine_state[\s\S]*from\s+public\.telemetry_devices/i);
});

test('stale prepaid balance requests do not look perpetually pending to operators', () => {
  const migration = acceptanceMigration();
  assert.ok(migration);
  const body = migration.content.match(/create\s+or\s+replace\s+function\s+public\.get_telemetry_prepaid_balances\s*\([\s\S]*?(?=revoke\s+all|grant\s+execute|comment\s+on|$)/i)?.[0] ?? '';
  assert.ok(body, 'get_telemetry_prepaid_balances must be redefined');
  assert.match(body, /request_pending[\s\S]*requested_at[\s\S]*interval\s+'30 minutes'/i);
  assert.match(body, /coalesce\s*\(\s*s\.request_pending\s*,\s*false\s*\)[\s\S]*s\.requested_at\s*>\s*now\(\)\s*-\s*interval\s+'30 minutes'/i);
});
