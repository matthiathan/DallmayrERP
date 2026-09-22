import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260921133000_harden_verified_profile_identity_evidence.sql', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../../components/telemetry-platform/ProfileIdentityEvidenceWorkspace.tsx', import.meta.url), 'utf8');
const contextLinks = fs.readFileSync(new URL('../../components/features/TelemetryDeviceContextLinks.tsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../app/telemetry/profile-identity/page.tsx', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../../components/layout/appShellNavigation.ts', import.meta.url), 'utf8');

test('verified profile evidence is promoted only through the controlled admin RPC', () => {
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger[\s\S]*from authenticated/i);
  assert.match(migration, /grant select on table public\.machine_model_profile_identity_evidence to authenticated;/);
  assert.match(migration, /perform public\.require_app_role\(array\['admin'\]\)/);
  assert.match(migration, /telemetry_region = v_region/);
  assert.match(migration, /reported_machine_profile_fingerprint/);
  assert.match(migration, /reported_machine_model/);
  assert.match(migration, /source_device_id/);
  assert.match(migration, /source_telemetry_region/);
  assert.match(migration, /verified_by_auth_user_id/);
  assert.match(migration, /verified_at/);
  assert.doesNotMatch(migration, /p_evidence_value\s+text/i);
});

test('identity candidate workflow remains region scoped and does not reassign machines', () => {
  assert.match(migration, /get_telemetry_profile_identity_candidate/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /assert_telemetry_region_selected\(\)/);
  assert.match(migration, /can_verify', public\.current_app_role\(\) = 'admin'/);
  assert.doesNotMatch(migration, /update\s+public\.telemetry_devices[\s\S]*machine_id\s*=/i);
  assert.doesNotMatch(migration, /update\s+public\.machines[\s\S]*=/i);
});

test('profile identity review workspace is reachable from canonical telemetry navigation', () => {
  assert.match(page, /ProfileIdentityEvidenceWorkspace/);
  assert.match(page, /title="Profile identity"/);
  assert.match(navigation, /href: '\/telemetry\/profile-identity'/);
  assert.match(navigation, /label: 'Profile Identity'/);
  assert.match(contextLinks, /telemetry\/profile-identity\?device=/);
  assert.match(contextLinks, /Profile identity/);
  assert.match(workspace, /get_telemetry_profile_identity_candidate/);
  assert.match(workspace, /verify_telemetry_profile_identity_evidence/);
  assert.match(workspace, /Verify fingerprint/);
  assert.match(workspace, /Verify reported model alias/);
  assert.match(workspace, /Administrator verification required/);
  assert.match(workspace, /pageSize: PAGE_SIZE/);
});
