import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationDir = new URL('../../supabase/migrations/', import.meta.url);

async function migration() {
  const files = await readdir(migrationDir);
  const name = files.find((file) => file.endsWith('_harden_legacy_region_move_sources.sql'));
  assert.ok(name, 'A dedicated legacy region-move source migration must exist');
  return readFile(new URL(name, migrationDir), 'utf8');
}

function functionBody(sql, name) {
  const lower = sql.toLowerCase();
  const start = lower.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must be redefined`);
  const next = lower.indexOf('create or replace function public.', start + 1);
  return sql.slice(start, next === -1 ? sql.length : next);
}

test('legacy device region moves require the selected source region before override', async () => {
  const sql = await migration();
  const body = functionBody(sql, 'set_device_telemetry_region');
  assert.match(body, /assert_telemetry_region_selected\s*\(/i);
  assert.match(body, /telemetry_region\s*=\s*v_source_region/i);
  const sourceCheck = body.search(/telemetry_region\s*=\s*v_source_region/i);
  const override = body.search(/set_config\s*\(\s*'app\.telemetry_region_override'/i);
  assert.ok(sourceCheck >= 0 && override > sourceCheck, 'Source-region ownership must be established before enabling region override');
});

test('legacy customer-site moves require the selected source region before cascading machines', async () => {
  const sql = await migration();
  const body = functionBody(sql, 'set_customer_site_telemetry_region');
  assert.match(body, /assert_telemetry_region_selected\s*\(/i);
  assert.match(body, /telemetry_region\s*=\s*v_source_region/i);
  assert.match(body, /for\s+update/i);
  const sourceCheck = body.search(/telemetry_region\s*=\s*v_source_region/i);
  const override = body.search(/set_config\s*\(\s*'app\.telemetry_region_override'/i);
  assert.ok(sourceCheck >= 0 && override > sourceCheck, 'Site source-region ownership must be locked before enabling region override');
});

test('legacy move grants remain authenticated and service-role only', async () => {
  const sql = await migration();
  for (const signature of [
    'set_device_telemetry_region(uuid,text)',
    'set_customer_site_telemetry_region(uuid,text)',
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${escaped}\\s+from\\s+public\\s*,\\s*anon`, 'i'));
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${escaped}\\s+to\\s+authenticated\\s*,\\s*service_role`, 'i'));
  }
});
