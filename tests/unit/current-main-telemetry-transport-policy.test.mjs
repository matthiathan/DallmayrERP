import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(new URL(name, migrationsUrl), 'utf8'))
  .join('\n');
const ingest = fs.readFileSync(new URL('../../supabase/functions/telemetry-ingest/index.ts', import.meta.url), 'utf8');

test('current telemetry stamps successful transport receipt time and exposes region-scoped per-network usage', () => {
  assert.match(migrations, /add column if not exists last_transport_at timestamptz/i);
  assert.match(migrations, /before update of last_transport on public\.telemetry_devices/i);
  assert.match(migrations, /new\.last_transport_at\s*:=\s*now\(\)/i);
  assert.match(migrations, /create or replace function public\.get_telemetry_transport_usage\s*\(/i);
  assert.match(migrations, /perform public\.assert_telemetry_region_selected\s*\(\s*\)/i);
  assert.match(migrations, /public\.telemetry_region_allows_device\s*\(\s*d\.id\s*\)/i);
  assert.match(migrations, /group by\s+u\.device_id\s*,\s*u\.transport/i);
  assert.match(migrations, /revoke all on function public\.get_telemetry_transport_usage\(integer\) from public, anon/i);
  assert.match(migrations, /grant execute on function public\.get_telemetry_transport_usage\(integer\) to authenticated/i);
});

test('config acknowledgement ingest has a durable service-role-only database contract', () => {
  assert.match(ingest, /eventType === 'config_ack'/);
  assert.match(ingest, /rpc\('record_telemetry_config_ack'/);
  assert.match(migrations, /add column if not exists last_config_ack_at timestamptz/i);
  assert.match(migrations, /add column if not exists applied_config jsonb/i);
  assert.match(migrations, /create or replace function public\.record_telemetry_config_ack\s*\(/i);
  assert.match(migrations, /jsonb_typeof\(v_applied\)\s*<>\s*'object'/i);
  assert.match(migrations, /last_config_ack_at\s*=\s*now\(\)/i);
  assert.match(migrations, /applied_config\s*=\s*v_applied/i);
  assert.match(migrations, /revoke all on function public\.record_telemetry_config_ack\(uuid, jsonb\) from authenticated/i);
  assert.match(migrations, /grant execute on function public\.record_telemetry_config_ack\(uuid, jsonb\) to service_role/i);
});
