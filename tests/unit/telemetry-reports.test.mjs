import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('telemetry reports is an authenticated telemetry route and owns its presentation', async () => {
  const [navigation, page, component, styles] = await Promise.all([
    read('components/layout/appShellNavigation.ts'),
    read('app/telemetry/reports/page.tsx'),
    read('components/telemetry-platform/TelemetryReports.tsx'),
    read('components/telemetry-platform/TelemetryReports.module.css'),
  ]);

  assert.match(navigation, /href: '\/telemetry\/reports', label: 'Reports & Exports'/);
  assert.match(page, /<TelemetryReports \/>/);
  assert.match(component, /import styles from '\.\/TelemetryReports\.module\.css';/);
  assert.match(styles, /@media\(max-width:900px\),\(max-width:1366px\) and \(hover:none\) and \(pointer:coarse\)/);
});

test('reports use real production telemetry and expose the six operational report groups', async () => {
  const component = await read('components/telemetry-platform/TelemetryReports.tsx');

  assert.match(component, /get_telemetry_reporting/);
  assert.match(component, /p_dataset: 'production'/);
  assert.match(component, /get_telemetry_data_usage/);
  assert.match(component, /get_telemetry_prepaid_balances/);
  assert.match(component, /get_telemetry_location_map/);
  assert.match(component, /telemetry_fault_events/);
  for (const label of ['Sales & cups', 'Products', 'Machines', 'Faults', 'Data & SIM', 'Fleet readiness']) {
    assert.ok(component.includes(label), `missing report group ${label}`);
  }
  assert.match(component, /Historical uptime is not inferred from this snapshot/);
  assert.doesNotMatch(component, /p_dataset:\s*dataset/);
});

test('report exports use local business dates and never derive filenames from UTC calendar dates', async () => {
  const component = await read('components/telemetry-platform/TelemetryReports.tsx');
  assert.match(component, /formatLocalDate/);
  assert.match(component, /addLocalDays/);
  assert.doesNotMatch(component, /toISOString\(\)\.slice\(0,\s*10\)/);
  assert.match(component, /Download CSV/);
  assert.match(component, /Production only/);
});

test('telemetry reporting access migration aligns read-only RPCs to active authenticated app users', async () => {
  const migration = await read('supabase/migrations/20260910132826_telemetry_reporting_authenticated_access.sql');
  assert.match(migration, /get_telemetry_reporting\(text,text,text\)/);
  assert.match(migration, /get_telemetry_dashboard\(text,text\)/);
  assert.match(migration, /public\.is_active_app_user\(\)/);
  assert.match(migration, /revoke all on function public\.get_telemetry_reporting\(text,text,text\) from public, anon/);
  assert.match(migration, /grant execute on function public\.get_telemetry_reporting\(text,text,text\) to authenticated, service_role/);
});

test('branch filters scope device availability and simulation state with the same machine or site branch contract', async () => {
  const migration = await read('supabase/migrations/20260911051000_telemetry_reporting_branch_device_scope.sql');

  assert.match(migration, /device_scope as \(/);
  assert.match(migration, /left join public\.customer_sites cs on cs\.id = coalesce\(d\.site_id, m\.site_id\)/);
  assert.match(migration, /lower\(coalesce\(m\.branch, cs\.branch, ''\)\) = v_branch/);
  assert.match(migration, /'reporting_devices', \(select count\(\*\) from device_scope\)/);
  assert.match(migration, /from device_scope ds\s+cross join lateral public\.get_telemetry_connectivity_state\(ds\.id\) c/);
  assert.match(migration, /join device_scope ds on ds\.id = ms\.device_id/);
  assert.match(migration, /'unassigned_devices', \(select count\(\*\) from device_scope where machine_id is null\)/);
});

test('global search derives pages from the canonical telemetry navigation and exposes specialist workspaces', async () => {
  const search = await read('components/ui/GlobalSearch.tsx');

  assert.match(search, /import \{ telemetryNavigationSections \} from '@\/components\/layout\/appShellNavigation';/);
  assert.match(search, /telemetryNavigationSections\.flatMap/);
  assert.doesNotMatch(search, /const focusedPages =/);
  assert.match(search, /href="\/telemetry\/reports"/);
  assert.match(search, /href="\/telemetry\/test-center"/);
  assert.match(search, /href="\/products"/);
  assert.match(search, /Reports & exports/);
});
