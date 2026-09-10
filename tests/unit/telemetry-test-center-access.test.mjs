import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260910081226_telemetry_test_center_authenticated_access.sql', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../../components/features/TelemetryTestCenter.tsx', import.meta.url), 'utf8');

test('Remote Test Center is available to active authenticated app users without role gating', () => {
  assert.match(migration, /create or replace function public\.is_active_app_user\(\)/i);
  assert.match(migration, /u\.auth_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /u\.is_active = true/i);
  assert.doesNotMatch(migration, /current_app_role\(\)\s*<>\s*'admin'/i);
  assert.doesNotMatch(migration, /Administrator access is required/i);
  assert.match(migration, /to authenticated\s+using \(public\.is_active_app_user\(\)\)/i);
  assert.match(migration, /requested_by = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/i);
});

test('Remote Test Center keeps the operational safety envelope', () => {
  assert.match(migration, /where id = p_device_id and status = 'active'/i);
  assert.match(migration, /greatest\(5, least\(coalesce\(p_duration_minutes, 30\), 60\)\)/i);
  assert.match(migration, /'STATUS','MACHINE IDENTITY','CUP COUNTERS','DATA USAGE','CELL PPP STATUS','WIRING','HELP'/i);
  assert.match(migration, /revoke all on function public\.start_telemetry_test_session[\s\S]*from public, anon/i);
  assert.match(migration, /grant execute on function public\.start_telemetry_test_session[\s\S]*to authenticated/i);
  assert.match(migration, /grant execute on function public\.queue_telemetry_test_command[\s\S]*to authenticated/i);
});

test('Test Center UI uses the protected session and command RPCs', () => {
  assert.match(workspace, /rpc\('start_telemetry_test_session'/);
  assert.match(workspace, /rpc\('stop_telemetry_test_session'/);
  assert.match(workspace, /rpc\('queue_telemetry_test_command'/);
  assert.match(workspace, /SAFE_COMMANDS/);
});
