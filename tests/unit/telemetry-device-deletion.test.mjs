import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const component = fs.readFileSync(new URL('../../components/features/AdminTelemetryDevices.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20260820070000_delete_telemetry_devices.sql', import.meta.url), 'utf8');

test('device management requires the exact device ID before permanent deletion', () => {
  assert.match(component, /deleteConfirmation\.trim\(\) !== selectedDevice\.device_code/);
  assert.match(component, /data-dialog-initial-focus/);
  assert.match(component, /This action cannot be undone/);
  assert.match(component, /The assigned machine itself will not be deleted/);
});

test('device deletion uses one authenticated database RPC', () => {
  assert.match(component, /\.rpc\('delete_telemetry_device'/);
  assert.match(migration, /if auth\.uid\(\) is null then/);
  assert.match(migration, /trim\(coalesce\(p_device_code, ''\)\) <> v_device\.device_code/);
  assert.match(migration, /delete from public\.telemetry_daily_item_sales[\s\S]*where device_id = v_device\.id/);
  assert.match(migration, /delete from public\.telemetry_devices[\s\S]*where id = v_device\.id/);
  assert.match(migration, /grant execute on function public\.delete_telemetry_device\(uuid, text\) to authenticated/);
});
