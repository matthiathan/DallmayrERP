import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20261019160000_paginate_customer_site_directory.sql', import.meta.url),
  'utf8',
);
const workspace = fs.readFileSync(
  new URL('../../components/telemetry-platform/CustomerSitesWorkspace.tsx', import.meta.url),
  'utf8',
);

test('customer directory is server-paginated and region scoped', () => {
  assert.match(migration, /get_telemetry_customer_site_directory/);
  assert.match(migration, /assert_telemetry_region_selected/);
  assert.match(migration, /is_dallmayr_app_user/);
  assert.match(migration, /s\.telemetry_region=v_region/);
  assert.match(migration, /m\.telemetry_region=v_region/);
  assert.match(migration, /telemetry_account_allows_machine\(m\.id\)/);
  assert.match(migration, /telemetry_account_allows_device\(d\.id\)/);
  assert.match(migration, /limit v_limit offset v_offset/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit,50\),1\),100\)/);
});

test('customer directory search executes on the server instead of loading the whole fleet', () => {
  assert.match(workspace, /get_telemetry_customer_site_directory/);
  assert.match(workspace, /DIRECTORY_PAGE_SIZE = 50/);
  assert.match(workspace, /p_offset: directoryPage \* DIRECTORY_PAGE_SIZE/);
  assert.match(workspace, /p_search: debouncedSearch/);
  assert.match(workspace, /setTimeout\(\(\) => setDebouncedSearch\(search\.trim\(\)\), 250\)/);
  assert.doesNotMatch(workspace, /limit\(5000\)/);
  assert.doesNotMatch(workspace, /p_limit: 5000/);
});

test('customer detail remains bounded to the selected customer', () => {
  assert.match(workspace, /eq\('customer_id', customerId\).*limit\(500\)/s);
  assert.match(workspace, /p_customer_id: customerId/);
  assert.match(workspace, /p_limit: 250/);
});
