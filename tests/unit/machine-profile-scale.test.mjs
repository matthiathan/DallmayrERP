import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20261020081500_paginate_machine_profiles.sql', import.meta.url),
  'utf8',
);
const workspace = fs.readFileSync(
  new URL('../../components/telemetry-platform/MachineProfilesWorkspace.tsx', import.meta.url),
  'utf8',
);

test('machine profile directory is admin-only and paginated', () => {
  assert.match(migration, /get_machine_profile_directory/);
  assert.match(migration, /current_app_role\(\)<>'admin'/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit,50\),1\),100\)/);
  assert.match(migration, /limit v_limit offset v_offset/);
  assert.match(workspace, /PROFILE_PAGE_SIZE = 50/);
  assert.match(workspace, /p_offset: page \* PROFILE_PAGE_SIZE/);
  assert.match(workspace, /p_limit: PROFILE_PAGE_SIZE/);
});

test('machine profile device statistics remain region and tenant scoped', () => {
  assert.match(migration, /assert_telemetry_region_selected/);
  assert.match(migration, /d\.telemetry_region=v_region/);
  assert.match(migration, /telemetry_account_allows_device\(d\.id\)/);
  assert.match(migration, /pending_devices/);
  assert.match(migration, /profile_devices/);
});

test('profile drawer loads bounded detail instead of the full device fleet', () => {
  assert.match(migration, /get_machine_profile_detail/);
  assert.match(migration, /limit 250/);
  assert.match(workspace, /get_machine_profile_detail/);
  assert.match(workspace, /p_profile_id: selectedId/);
  assert.doesNotMatch(workspace, /limit\(5000\)/);
  assert.doesNotMatch(workspace, /from\('telemetry_devices'\)/);
});

test('profile search executes on the server', () => {
  assert.match(workspace, /p_search: debouncedSearch/);
  assert.match(workspace, /setTimeout\(\(\) => setDebouncedSearch\(search\.trim\(\)\), 250\)/);
});
