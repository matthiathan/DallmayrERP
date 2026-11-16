import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20261020070000_paginate_telemetry_archive.sql', import.meta.url),
  'utf8',
);
const workspace = fs.readFileSync(
  new URL('../../components/telemetry-platform/ArchiveWorkspace.tsx', import.meta.url),
  'utf8',
);

test('archive RPC is paginated, staff-only and region scoped', () => {
  assert.match(migration, /get_telemetry_archive/);
  assert.match(migration, /assert_telemetry_region_selected/);
  assert.match(migration, /is_dallmayr_app_user/);
  assert.match(migration, /m\.telemetry_region=v_region/);
  assert.match(migration, /d\.telemetry_region=v_region/);
  assert.match(migration, /telemetry_account_allows_machine\(m\.id\)/);
  assert.match(migration, /telemetry_account_allows_device\(d\.id\)/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit,50\),1\),100\)/);
  assert.match(migration, /limit v_limit offset v_offset/);
});

test('archive workspace uses server search and 50-row pages', () => {
  assert.match(workspace, /ARCHIVE_PAGE_SIZE = 50/);
  assert.match(workspace, /get_telemetry_archive/);
  assert.match(workspace, /p_search: debouncedSearch/);
  assert.match(workspace, /p_offset: page \* ARCHIVE_PAGE_SIZE/);
  assert.match(workspace, /p_limit: ARCHIVE_PAGE_SIZE/);
  assert.match(workspace, /setTimeout\(\(\) => setDebouncedSearch\(search\.trim\(\)\), 250\)/);
  assert.doesNotMatch(workspace, /collectSupabasePagesResult/);
  assert.doesNotMatch(workspace, /\.range\(from, to\)/);
});

test('archive summary remains fleet-wide while rows are paginated', () => {
  assert.match(migration, /'retired_machines',v_machine_total/);
  assert.match(migration, /'retired_devices',v_device_total/);
  assert.match(migration, /'linked_retired_devices',v_linked_device_total/);
  assert.match(workspace, /summary\.retiredMachines/);
  assert.match(workspace, /summary\.retiredDevices/);
  assert.match(workspace, /summary\.linkedRetiredDevices/);
});
