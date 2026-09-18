import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationDir = new URL('../../supabase/migrations/', import.meta.url);

async function migration() {
  const files = await readdir(migrationDir);
  const name = files.find((file) => file.endsWith('_harden_legacy_device_region_boundaries.sql'));
  assert.ok(name, 'A dedicated legacy device region-boundary migration must exist');
  return readFile(new URL(name, migrationDir), 'utf8');
}

function functionBody(sql, name) {
  const start = sql.toLowerCase().indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must be redefined`);
  const next = sql.toLowerCase().indexOf('create or replace function public.', start + 1);
  return sql.slice(start, next === -1 ? sql.length : next);
}

test('legacy device mutation RPCs require the selected telemetry region', async () => {
  const sql = await migration();
  for (const name of [
    'set_telemetry_device_control',
    'set_telemetry_device_location_control',
    'set_telemetry_device_mode',
    'set_telemetry_prepaid_balance_control',
  ]) {
    const body = functionBody(sql, name);
    assert.match(body, /assert_telemetry_region_selected\s*\(/i, `${name} must require a selected telemetry region`);
    assert.match(body, /telemetry_region\s*=\s*v_region/i, `${name} must constrain its device lookup to that region`);
  }
});

test('fleet attention mutations cannot target a device outside the selected region', async () => {
  const sql = await migration();
  const body = functionBody(sql, 'set_telemetry_fleet_attention_workflow');
  assert.match(body, /assert_telemetry_region_selected\s*\(/i);
  assert.match(body, /telemetry_region_allows_device\s*\(\s*p_device_id\s*\)/i);
});

test('legacy mutation grants remain authenticated and service-role only', async () => {
  const sql = await migration();
  const signatures = [
    'set_telemetry_device_control(text,text,text,boolean,boolean)',
    'set_telemetry_device_location_control(text,boolean,integer,integer)',
    'set_telemetry_device_mode(text,text)',
    'set_telemetry_prepaid_balance_control(text,integer,integer,integer,integer)',
    'set_telemetry_fleet_attention_workflow(text,uuid,text,text,timestamp with time zone,text)',
  ];
  for (const signature of signatures) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${escaped}\\s+from\\s+public\\s*,\\s*anon`, 'i'));
    assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${escaped}\\s+to\\s+authenticated\\s*,\\s*service_role`, 'i'));
  }
});
