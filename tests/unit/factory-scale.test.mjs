import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20261020074500_paginate_factory_directory.sql', import.meta.url),
  'utf8',
);
const workspace = fs.readFileSync(
  new URL('../../components/telemetry-platform/FactoryWorkspace.tsx', import.meta.url),
  'utf8',
);

test('Factory directory is admin-only, region scoped and paginated', () => {
  assert.match(migration, /get_telemetry_factory_directory/);
  assert.match(migration, /assert_telemetry_region_selected/);
  assert.match(migration, /current_app_role\(\)<>'admin'/);
  assert.match(migration, /d\.telemetry_region=v_region/);
  assert.match(migration, /telemetry_account_allows_device\(d\.id\)/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit,50\),1\),100\)/);
  assert.match(migration, /limit v_limit offset v_offset/);
});

test('Factory filtering and search execute on the server', () => {
  assert.match(migration, /v_view='provisioning'/);
  assert.match(migration, /v_view='testing'/);
  assert.match(migration, /v_view='firmware'/);
  assert.match(migration, /readiness_label/);
  assert.match(workspace, /get_telemetry_factory_directory/);
  assert.match(workspace, /FACTORY_PAGE_SIZE = 50/);
  assert.match(workspace, /p_search: debouncedSearch/);
  assert.match(workspace, /p_offset: page \* FACTORY_PAGE_SIZE/);
  assert.match(workspace, /p_limit: FACTORY_PAGE_SIZE/);
  assert.match(workspace, /setTimeout\(\(\) => setDebouncedSearch\(search\.trim\(\)\), 250\)/);
  assert.doesNotMatch(workspace, /collectSupabasePagesResult/);
});

test('Factory fleet metrics and firmware distribution remain server-wide', () => {
  assert.match(migration, /'needs_review',s\.needs_review/);
  assert.match(migration, /'firmware_groups'/);
  assert.match(workspace, /summary\.needs_review/);
  assert.match(workspace, /payload\.firmware_groups/);
});
