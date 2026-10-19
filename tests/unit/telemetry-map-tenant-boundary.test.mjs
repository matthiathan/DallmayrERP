import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const regionScope = fs.readFileSync(
  new URL('../../supabase/migrations/20260918090200_scope_telemetry_read_rpcs_by_region.sql', import.meta.url),
  'utf8',
);
const tenantScope = fs.readFileSync(
  new URL('../../supabase/migrations/20260923104500_add_client_tenant_access.sql', import.meta.url),
  'utf8',
);
const navigation = fs.readFileSync(
  new URL('../../components/layout/appShellNavigation.ts', import.meta.url),
  'utf8',
);

test('client-visible map is region scoped before tenant hardening is applied', () => {
  assert.match(regionScope, /create or replace function public\.get_telemetry_location_map\(\)/);
  assert.match(regionScope, /v_region text := public\.assert_telemetry_region_selected\(\)/);
  assert.match(regionScope, /where d\.status='active' and d\.telemetry_region=v_region/);
});

test('tenant hardening injects customer ownership into map and reporting security-definer reads', () => {
  assert.match(tenantScope, /'public\.get_telemetry_location_map\(\)'/);
  assert.match(tenantScope, /'public\.get_telemetry_reporting\(text,text,text\)'/);
  assert.match(
    tenantScope,
    /regexp_replace\(v_def,'d\\\\\.telemetry_region\\\\s\*=\\\\s\*v_region','d\.telemetry_region=v_region and public\.telemetry_account_allows_device\(d\.id\)'/,
  );
  assert.match(
    tenantScope,
    /regexp_replace\(v_def,'m\\\\\.telemetry_region\\\\s\*=\\\\s\*v_region','m\.telemetry_region=v_region and public\.telemetry_account_allows_machine\(m\.id\)'/,
  );
  assert.match(tenantScope, /Tenant filter injection point missing in %/);
});

test('map remains client-visible only alongside explicit database tenant filtering', () => {
  assert.match(navigation, /CLIENT_ALLOWED_PATHS = new Set\(\['\/', '\/machines', '\/telemetry', '\/telemetry\/reports', '\/map'\]\)/);
  assert.match(tenantScope, /telemetry_account_allows_device\(d\.id\)/);
  assert.match(tenantScope, /telemetry_account_allows_machine\(m\.id\)/);
});
