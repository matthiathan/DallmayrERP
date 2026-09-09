import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const browserSource = await readFile(new URL('../../components/telemetry-platform/MachineFleetBrowser.tsx', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('../../supabase/migrations/20260909124637_telemetry_machine_fleet_search.sql', import.meta.url), 'utf8');

test('machine fleet uses one server-paged telemetry RPC instead of downloading the machine master', () => {
  assert.match(browserSource, /\.rpc\('get_telemetry_machine_fleet'/);
  assert.match(browserSource, /p_offset:\s*\(targetPage - 1\) \* TABLE_PAGE_SIZE/);
  assert.match(browserSource, /p_limit:\s*TABLE_PAGE_SIZE/);
  assert.doesNotMatch(browserSource, /\.from\('machines'\)/);
  assert.doesNotMatch(browserSource, /\.from\('customer_sites'\)/);
  assert.doesNotMatch(browserSource, /DATABASE_PAGE_SIZE/);
});

test('fleet RPC performs search, telemetry status and fault aggregation before pagination', () => {
  assert.match(migrationSource, /create or replace function public\.get_telemetry_machine_fleet/);
  assert.match(migrationSource, /left join public\.telemetry_machine_state/);
  assert.match(migrationSource, /public\.telemetry_fault_events/);
  assert.match(migrationSource, /lower\(coalesce\(b\.device_code, ''\)\) like/);
  assert.match(migrationSource, /connection_status/);
  assert.match(migrationSource, /limit v_limit\s+offset v_offset/);
  assert.match(migrationSource, /least\(greatest\(coalesce\(p_limit, 75\), 1\), 250\)/);
  assert.match(migrationSource, /grant execute on function public\.get_telemetry_machine_fleet/);
});
