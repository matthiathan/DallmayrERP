import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260923081000_harden_telemetry_enrollment_token_controls.sql', import.meta.url), 'utf8');
const queue = fs.readFileSync(new URL('../../components/features/TelemetryCommissioningQueue.tsx', import.meta.url), 'utf8');

test('single-token status and revoke require active Administrator or Operations access', () => {
  for (const functionName of ['get_telemetry_enrollment_token_status', 'revoke_telemetry_enrollment_token']) {
    const start = migration.indexOf(`function public.${functionName}`);
    assert.notEqual(start, -1, `${functionName} must be defined`);
    const body = migration.slice(start, migration.indexOf('$$;', start) + 3);
    assert.match(body, /is_active_app_user\(\)/);
    assert.match(body, /require_app_role\(array\['admin','operations'\]\)/);
    assert.match(body, /telemetry_region = v_region/);
  }
});

test('single-token status and revoke are not executable by public or anon', () => {
  assert.match(migration, /revoke all on function public\.get_telemetry_enrollment_token_status\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.get_telemetry_enrollment_token_status\(uuid\) to authenticated/);
  assert.match(migration, /revoke all on function public\.revoke_telemetry_enrollment_token\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.revoke_telemetry_enrollment_token\(uuid\) to authenticated/);
});

test('commissioning queue can revoke only active unused waiting credentials', () => {
  assert.match(queue, /revoke_telemetry_enrollment_token/);
  assert.match(queue, /p_token_id: row\.token_id/);
  assert.match(queue, /row\.commissioning_state === 'waiting'/);
  assert.match(queue, /row\.token_status === 'active'/);
  assert.match(queue, /!row\.used_at/);
  assert.match(queue, /Revoke credential/);
  assert.doesNotMatch(queue, /token_hash/);
});
