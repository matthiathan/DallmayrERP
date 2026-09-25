import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../../supabase/migrations/20260923104500_add_client_tenant_access.sql', import.meta.url), 'utf8');
const clientAccess = fs.readFileSync(new URL('../../components/features/ClientAccessControl.tsx', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../../components/layout/appShellNavigation.ts', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../../components/layout/AppShell.tsx', import.meta.url), 'utf8');
const usersPage = fs.readFileSync(new URL('../../app/users/page.tsx', import.meta.url), 'utf8');

test('client accounts are explicitly bound to one customer and use a non-staff role', () => {
  assert.match(migration, /account_scope text not null default 'dallmayr'/);
  assert.match(migration, /users_client_customer_check/);
  assert.match(migration, /account_scope = 'client' and customer_id is not null/);
  assert.match(migration, /'client_viewer'/);
  assert.match(migration, /v_role := 'client_viewer'/);
});

test('tenant helpers fail closed and resolve machine and device ownership by customer', () => {
  assert.match(migration, /current_app_account_scope/);
  assert.match(migration, /current_app_customer_id/);
  assert.match(migration, /telemetry_account_allows_machine/);
  assert.match(migration, /m\.customer_id = public\.current_app_customer_id\(\)/);
  assert.match(migration, /telemetry_account_allows_device/);
  assert.match(migration, /join public\.machines m on m\.id = d\.machine_id/);
  assert.match(migration, /public\.telemetry_region_allows_device/);
});

test('direct authenticated reads use restrictive customer policies and client writes are denied', () => {
  assert.match(migration, /create policy tenant_machine_select on public\.machines as restrictive for select/);
  assert.match(migration, /create policy tenant_device_select on public\.telemetry_devices as restrictive for select/);
  assert.match(migration, /tenant_dallmayr_insert_guard/);
  assert.match(migration, /tenant_dallmayr_update_guard/);
  assert.match(migration, /tenant_dallmayr_delete_guard/);
  assert.match(migration, /public\.is_dallmayr_app_user\(\)/);
});

test('security definer telemetry reads receive customer filters instead of relying on RLS', () => {
  assert.match(migration, /get_telemetry_dashboard/);
  assert.match(migration, /get_telemetry_machine_fleet/);
  assert.match(migration, /get_telemetry_reporting/);
  assert.match(migration, /get_telemetry_activity/);
  assert.match(migration, /get_telemetry_location_map/);
  assert.match(migration, /get_telemetry_data_usage/);
  assert.match(migration, /get_telemetry_prepaid_balances/);
  assert.match(migration, /telemetry_account_allows_device\(d\.id\)/);
  assert.match(migration, /telemetry_account_allows_machine\(m\.id\)/);
  assert.match(migration, /Tenant filter injection point missing/);
});

test('Dallmayr administrators can create and manage customer-scoped client access', () => {
  assert.match(migration, /admin_list_client_customer_targets/);
  assert.match(migration, /admin_create_user_access_v2/);
  assert.match(migration, /admin_update_user_access_v2/);
  assert.match(migration, /admin_list_user_access_v2/);
  assert.match(clientAccess, /data-client-access-control="v1"/);
  assert.match(clientAccess, /Create company-scoped access/);
  assert.match(clientAccess, /p_account_scope: 'client'/);
  assert.match(clientAccess, /p_customer_id: customerId/);
  assert.match(usersPage, /ClientAccessControl/);
  assert.match(usersPage, /AdminUserAccessControl/);
});

test('client shell exposes only explicitly approved read-only routes', () => {
  assert.match(navigation, /CLIENT_ALLOWED_PATHS/);
  assert.match(navigation, /'\/machines'/);
  assert.match(navigation, /'\/telemetry\/reports'/);
  assert.match(navigation, /'\/map'/);
  assert.match(navigation, /return pathname\.startsWith\('\/machines\/'\)/);
  assert.match(navigation, /if \(accountScope === 'client'\) return clientCanAccessPath\(pathname\)/);
  assert.doesNotMatch(navigation, /if \(accountScope === 'client'\)[^\n]*pathname\.startsWith/);
  assert.match(navigation, /Users & Client Access/);
  assert.match(shell, /data-account-scope=\{accountScope\}/);
  assert.match(shell, /!isClient \? <TelemetryRegionSelector/);
  assert.match(shell, /This client account can only open read-only telemetry pages for its assigned company/);
});
