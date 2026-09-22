import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260922063000_add_profile_rollout_queue_summary.sql', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../../components/telemetry-platform/ProfileRolloutWorkspace.tsx', import.meta.url), 'utf8');
const contextLinks = fs.readFileSync(new URL('../../components/features/TelemetryDeviceContextLinks.tsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../app/telemetry/devices/profile-rollout/page.tsx', import.meta.url), 'utf8');

test('fleet RPC exposes authoritative decoder rollout filters and summary counts', () => {
  for (const filter of ['profile_configured', 'profile_pending', 'profile_ambiguous', 'profile_unmatched']) {
    assert.match(migration, new RegExp(filter));
  }
  for (const summaryKey of [
    'linked_devices',
    'profile_configured',
    'profile_pending',
    'profile_ambiguous',
    'profile_unmatched',
    'profile_manual',
    'profile_automatic',
    'profile_resolved',
    'profile_unresolved',
    'profile_attention',
  ]) {
    assert.match(migration, new RegExp(summaryKey));
  }
  assert.match(migration, /resolve_telemetry_device_profile_region_unscoped/);
  assert.match(migration, /reported_machine_profile_fingerprint/);
});

test('rollout RPC keeps regional and API execution boundaries intact', () => {
  assert.match(migration, /assert_telemetry_region_selected\(\)/);
  assert.match(migration, /d\.telemetry_region=v_region/);
  assert.match(migration, /m\.telemetry_region=v_region/);
  assert.match(migration, /revoke all on function public\.get_telemetry_machine_fleet[\s\S]*from public/i);
  assert.match(migration, /revoke execute on function public\.get_telemetry_machine_fleet[\s\S]*from anon/i);
  assert.match(migration, /grant execute on function public\.get_telemetry_machine_fleet[\s\S]*to authenticated, service_role/i);
});

test('profile rollout workspace uses server-side fleet resolution and operational actions', () => {
  assert.match(page, /ProfileRolloutWorkspace/);
  assert.match(page, /Decoder profile rollout/);
  assert.match(contextLinks, /telemetry\/devices\/profile-rollout/);
  assert.match(contextLinks, /Profile rollout/);
  assert.match(workspace, /get_telemetry_machine_fleet/);
  assert.match(workspace, /useState<ProfileQueueFilter>\('profile_attention'\)/);
  assert.match(workspace, /Configured/);
  assert.match(workspace, /Pending ACK/);
  assert.match(workspace, /Ambiguous/);
  assert.match(workspace, /Unmatched/);
  assert.match(workspace, /profile-identity\?device=/);
  assert.match(workspace, /test-center\?device=/);
  assert.match(workspace, /p_offset: offset/);
  assert.match(workspace, /p_limit: PAGE_SIZE/);
});
