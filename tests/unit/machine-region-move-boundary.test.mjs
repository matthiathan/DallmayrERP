import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8') }));

test('machine region moves can only originate in the operator selected telemetry region', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_harden_machine_region_move_source.sql'));
  assert.ok(migration, 'A dedicated machine region-move source-boundary migration must exist');

  const match = migration.content.match(/create\s+or\s+replace\s+function\s+public\.set_machine_telemetry_region\s*\([\s\S]*?(?=revoke\s+all|grant\s+execute|comment\s+on|$)/i);
  assert.ok(match, 'set_machine_telemetry_region must be redefined');
  const body = match[0];

  assert.match(body, /v_source_region\s+text\s*:=\s*public\.assert_telemetry_region_selected\s*\(\s*\)/i);
  assert.match(body, /where\s+(?:m\.)?id\s*=\s*p_machine_id[\s\S]*?telemetry_region\s*=\s*v_source_region/i);
  assert.match(body, /update\s+public\.machines[\s\S]*?where\s+id\s*=\s*p_machine_id[\s\S]*?telemetry_region\s*=\s*v_source_region/i);
});

test('machine region move preserves privileged role check and authenticated execution grants', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_harden_machine_region_move_source.sql'));
  assert.ok(migration);
  assert.match(migration.content, /public\.can_manage_telemetry_regions\s*\(\s*\)/i);
  assert.match(migration.content, /revoke\s+all\s+on\s+function\s+public\.set_machine_telemetry_region\(uuid,\s*text\)\s+from\s+public,\s*anon/i);
  assert.match(migration.content, /grant\s+execute\s+on\s+function\s+public\.set_machine_telemetry_region\(uuid,\s*text\)\s+to\s+authenticated,\s*service_role/i);
});
