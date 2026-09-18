import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8') }));

test('opening an enrollment window only closes windows in the selected telemetry region', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_isolate_enrollment_windows_by_region.sql'));
  assert.ok(migration, 'A dedicated enrollment window region-isolation migration must exist');

  const match = migration.content.match(/create\s+or\s+replace\s+function\s+public\.open_telemetry_enrollment_window\s*\([\s\S]*?(?=revoke\s+all|grant\s+execute|comment\s+on|$)/i);
  assert.ok(match, 'open_telemetry_enrollment_window must be redefined');
  const body = match[0];

  assert.match(body, /v_region\s+text\s*:=\s*public\.assert_telemetry_region_selected\s*\(\s*\)/i);

  const openWindowUpdates = [...body.matchAll(/update\s+public\.telemetry_enrollment_windows[\s\S]*?where\s+status\s*=\s*'open'[\s\S]*?;/gi)];
  assert.equal(openWindowUpdates.length, 2, 'The expiry and cancellation updates must both remain explicit');
  for (const update of openWindowUpdates) {
    assert.match(update[0], /telemetry_region\s*=\s*v_region/i, 'Every open-window update must be scoped to the selected region');
  }
});

test('enrollment window region isolation preserves authenticated-only execution', () => {
  const migration = migrations.find(({ name }) => name.endsWith('_isolate_enrollment_windows_by_region.sql'));
  assert.ok(migration);
  const signature = 'open_telemetry_enrollment_window(integer, integer, text, text)';
  assert.match(migration.content, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+from\\s+public,\\s*anon`, 'i'));
  assert.match(migration.content, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+to\\s+authenticated,\\s*service_role`, 'i'));
});
