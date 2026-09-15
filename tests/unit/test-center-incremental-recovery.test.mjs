import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const component = fs.readFileSync('components/features/TelemetryTestCenter.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260915112000_telemetry_test_center_incremental_recovery.sql', 'utf8');

test('Test Center uses bounded server-side device search instead of loading the active fleet', () => {
  assert.match(component, /rpc\(['"]search_telemetry_test_devices['"]/);
  assert.doesNotMatch(component, /\.from\(['"]telemetry_devices['"]\)/);
  assert.match(component, /p_limit:\s*75/);
});

test('Test Center recovers logs incrementally from the persisted cursor', () => {
  assert.match(component, /rpc\(['"]get_telemetry_test_logs['"]/);
  assert.match(component, /p_after_id:\s*recoveryCursorRef\.current/);
  assert.doesNotMatch(component, /\.from\(['"]telemetry_debug_logs['"]\)/);
  assert.match(component, /recoverLogs/);
});

test('Realtime remains the fast path while polling is only a recovery path', () => {
  assert.match(component, /table:\s*['"]telemetry_debug_logs['"]/);
  assert.match(component, /postgres_changes/);
  assert.match(component, /void recoverLogs\(updated\.id\)/);
  assert.doesNotMatch(component, /void loadLogs\(updated\.id\)/);
});

test('incremental Test Center RPCs retain authenticated invoker access', () => {
  assert.match(migration, /function public\.get_telemetry_test_logs/);
  assert.match(migration, /function public\.search_telemetry_test_devices/);
  assert.match(migration, /security invoker/gi);
  assert.match(migration, /revoke all on function public\.get_telemetry_test_logs[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.get_telemetry_test_logs[\s\S]*to authenticated/);
  assert.match(migration, /revoke all on function public\.search_telemetry_test_devices[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.search_telemetry_test_devices[\s\S]*to authenticated/);
});
