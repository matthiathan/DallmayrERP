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
const configSync = fs.readFileSync(new URL('../../supabase/migrations/20260911060543_telemetry_device_config_sync_history.sql', import.meta.url), 'utf8');
const devicesPage = fs.readFileSync(new URL('../../app/telemetry/devices/page.tsx', import.meta.url), 'utf8');
const networkUsagePanelUrl = new URL('../../components/telemetry-platform/TelemetryNetworkUsagePanel.tsx', import.meta.url);

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

test('current-main config acknowledgement remains on the tracked configuration-sync contract', () => {
  assert.match(ingest, /payload\.type\s*===\s*["']config_ack["']/);
  assert.match(ingest, /rpc\('record_telemetry_config_ack'/);
  assert.match(configSync, /create table if not exists public\.telemetry_device_config_history/i);
  assert.match(configSync, /create or replace function public\.record_telemetry_config_ack\s*\(/i);
  assert.match(configSync, /last_config_ack_at\s*=\s*now\(\)/i);
  assert.match(configSync, /applied_config\s*=\s*v_applied/i);
  assert.match(configSync, /v_sync_status := case when v_differences = '\{\}'::jsonb then 'applied' else 'mismatch' end/i);
  assert.match(configSync, /unreported_fields\s*=\s*v_unreported/i);
  assert.match(configSync, /grant execute on function public\.record_telemetry_config_ack\(uuid,jsonb\) to service_role/i);
});

test('device management surfaces actual transport and separate Wi-Fi and cellular usage', () => {
  assert.equal(fs.existsSync(networkUsagePanelUrl), true, 'Device Management needs a per-network usage panel on the current telemetry route');
  const panel = fs.readFileSync(networkUsagePanelUrl, 'utf8');
  assert.match(devicesPage, /TelemetryNetworkUsagePanel/);
  assert.match(panel, /get_telemetry_transport_usage/);
  assert.match(panel, /last_transport_at/);
  assert.match(panel, /Wi-Fi · last 30 days/);
  assert.match(panel, /Cellular · last 30 days/);
  assert.match(panel, /Current transport/);
});
