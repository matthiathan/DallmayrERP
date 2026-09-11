import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('device configuration saves are atomic and create a tracked pending request', async () => {
  const migration = await read('supabase/migrations/20260911060543_telemetry_device_config_sync_history.sql');
  assert.match(migration, /create table if not exists public\.telemetry_device_config_history/);
  assert.match(migration, /create or replace function public\.save_telemetry_device_configuration/);
  assert.match(migration, /if not public\.is_active_app_user\(\)/);
  assert.match(migration, /set status = 'superseded'/);
  assert.match(migration, /insert into public\.telemetry_device_config_history/);
  assert.match(migration, /'status', 'pending'/);
  assert.match(migration, /grant execute on function public\.save_telemetry_device_configuration[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon/);
});

test('device configuration ACK records applied, mismatch and unreported-field evidence', async () => {
  const migration = await read('supabase/migrations/20260911060543_telemetry_device_config_sync_history.sql');
  assert.match(migration, /create or replace function public\.record_telemetry_config_ack/);
  assert.match(migration, /v_sync_status := case when v_differences = '\{\}'::jsonb then 'applied' else 'mismatch' end/);
  for (const field of [
    'mode', 'transport_preference', 'wifi_enabled', 'cellular_enabled',
    'location_enabled', 'location_interval_minutes', 'location_min_move_m',
  ]) assert.match(migration, new RegExp(`'${field}'`));
  for (const field of ['mdb_master_polarity', 'mdb_slave_polarity', 'mdb_pin_swap']) {
    assert.match(migration, new RegExp(`'${field}'`));
  }
  assert.match(migration, /unreported_fields = v_unreported/);
  assert.match(migration, /grant execute on function public\.record_telemetry_config_ack\(uuid,jsonb\) to service_role/);
});

test('existing config fetch timestamp drives delivery tracking without a firmware/API change', async () => {
  const migration = await read('supabase/migrations/20260911061603_telemetry_config_delivery_tracking.sql');
  const configService = await read('supabase/functions/telemetry-config/index.ts');
  assert.match(migration, /after update of last_config_at on public\.telemetry_devices/);
  assert.match(migration, /set delivered_at = coalesce\(delivered_at, new\.last_config_at\)/);
  assert.match(configService, /update\(\{ last_config_at: nowIso \}\)/);
  assert.doesNotMatch(configService, /telemetry_device_config_history/);
});

test('current telemetry operator controls use the active-account model instead of ERP roles', async () => {
  const migration = await read('supabase/migrations/20260911060835_telemetry_no_role_operator_access.sql');
  for (const rpc of [
    'open_telemetry_enrollment_window',
    'close_telemetry_enrollment_window',
    'get_telemetry_enrollment_window_status',
    'create_telemetry_enrollment_token',
    'get_telemetry_enrollment_token_status',
    'revoke_telemetry_enrollment_token',
    'request_telemetry_prepaid_balance',
    'delete_telemetry_device',
    'set_telemetry_device_profile',
    'set_telemetry_alarm_workflow',
  ]) assert.match(migration, new RegExp(`function public\\.${rpc}`));
  assert.match(migration, /public\.is_active_app_user\(\)/);
  assert.doesNotMatch(migration, /Only an Administrator|Only admin or operations/);
});

test('Device Management uses one atomic save RPC and exposes requested-vs-applied sync state', async () => {
  const workspace = await read('components/telemetry-platform/TelemetryDevicesWorkspace.tsx');
  const panel = await read('components/telemetry-platform/TelemetryConfigSyncPanel.tsx');
  assert.match(workspace, /rpc\('save_telemetry_device_configuration'/);
  assert.doesNotMatch(workspace, /set_telemetry_device_control|set_telemetry_device_location_control|set_telemetry_prepaid_balance_control/);
  assert.doesNotMatch(workspace, /from\('telemetry_devices'\)\.update/);
  assert.match(workspace, /TelemetryConfigSyncPanel/);
  assert.match(panel, /get_telemetry_device_config_history/);
  assert.match(panel, /Pending device fetch/);
  assert.match(panel, /Sent · waiting for ACK/);
  assert.match(panel, /Configuration mismatch/);
  assert.match(panel, /Saved but not reported by the current ACK/);
  assert.match(panel, /Their absence from the current ACK is not treated as a failure/);
});
