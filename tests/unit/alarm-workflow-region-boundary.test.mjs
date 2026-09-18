import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8') }));

test('alarm workflow mutations require the selected telemetry region', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_harden_alarm_workflow_region_boundary.sql'));
  assert.ok(migration, 'A dedicated alarm-workflow region-boundary migration must exist');

  const body = migration.content.match(/create\s+or\s+replace\s+function\s+public\.set_telemetry_alarm_workflow\s*\([\s\S]*?(?=revoke\s+all|grant\s+execute|comment\s+on|$)/i)?.[0] ?? '';
  assert.ok(body, 'set_telemetry_alarm_workflow must be redefined');
  assert.match(body, /assert_telemetry_region_selected\s*\(\s*\)/i);
  assert.match(body, /telemetry_region_allows_fault\s*\(\s*p_fault_id\s*\)/i);
});

test('alarm workflow keeps the active-account model and existing execution grants', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_harden_alarm_workflow_region_boundary.sql'));
  assert.ok(migration);

  assert.match(migration.content, /public\.is_active_app_user\s*\(\s*\)/i);
  assert.doesNotMatch(migration.content, /current_app_role\s*\(/i, 'alarm workflow must not introduce a new ERP role gate');
  assert.match(migration.content, /revoke\s+all\s+on\s+function\s+public\.set_telemetry_alarm_workflow\(uuid,\s*text,\s*text\)\s+from\s+public,\s*anon/i);
  assert.match(migration.content, /grant\s+execute\s+on\s+function\s+public\.set_telemetry_alarm_workflow\(uuid,\s*text,\s*text\)\s+to\s+authenticated,\s*service_role/i);
});
