import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8') }));

test('product mapping operational summary scopes machine and device evidence to the selected region', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_scope_product_mapping_operational_summary.sql'));
  assert.ok(migration, 'A dedicated product-mapping operational region migration must exist');

  const body = migration.content.match(/create\s+or\s+replace\s+function\s+public\.get_product_mapping_operational_summary\s*\(\s*\)[\s\S]*?(?=revoke\s+all|grant\s+execute|comment\s+on|$)/i)?.[0] ?? '';
  assert.ok(body, 'get_product_mapping_operational_summary must be redefined');
  assert.match(body, /assert_telemetry_region_selected\s*\(\s*\)/i);
  assert.match(body, /d\.telemetry_region\s*=\s*v_region/i, 'active-device evidence must be region-scoped');
  assert.match(body, /m\.telemetry_region\s*=\s*v_region/i, 'machine counts must be region-scoped');
});

test('service role remains global while authenticated users require the selected region', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_scope_product_mapping_operational_summary.sql'));
  assert.ok(migration);

  assert.match(migration.content, /v_is_service_role/i);
  assert.match(migration.content, /v_is_service_role\s+or\s+d\.telemetry_region\s*=\s*v_region/i);
  assert.match(migration.content, /v_is_service_role\s+or\s+m\.telemetry_region\s*=\s*v_region/i);
  assert.match(migration.content, /revoke\s+all\s+on\s+function\s+public\.get_product_mapping_operational_summary\(\)\s+from\s+public,\s*anon/i);
  assert.match(migration.content, /grant\s+execute\s+on\s+function\s+public\.get_product_mapping_operational_summary\(\)\s+to\s+authenticated,\s*service_role/i);
});
