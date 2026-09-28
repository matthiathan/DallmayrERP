import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(new URL(name, migrationsUrl), 'utf8'))
  .join('\n');
const fleetBrowser = fs.readFileSync(new URL('../../components/telemetry-platform/MachineFleetBrowser.tsx', import.meta.url), 'utf8');

test('machine fleet API supports server-side customer/site filtering and commissioning readiness', () => {
  assert.match(migrations, /create or replace function public\.get_telemetry_machine_fleet\s*\(\s*p_search text[\s\S]*p_customer_id uuid[\s\S]*p_site_id uuid/i);
  assert.match(migrations, /customer_id/i);
  assert.match(migrations, /customer_name/i);
  assert.match(migrations, /commissioning_status/i);
  assert.match(migrations, /mapping_attention/i);
  assert.match(migrations, /configuration_pending/i);
  assert.match(migrations, /'customers'/i);
  assert.match(migrations, /'sites'/i);
  assert.match(migrations, /grant execute on function public\.get_telemetry_machine_fleet\(text,text,text,uuid,uuid,integer,integer\) to authenticated/i);
  assert.match(migrations, /revoke all on function public\.get_telemetry_machine_fleet\(text,text,text,uuid,uuid,integer,integer\) from public, anon/i);
});

test('Machines exposes customer, site and commissioning filters without client-side page filtering', () => {
  assert.match(fleetBrowser, /p_customer_id:\s*customerId/);
  assert.match(fleetBrowser, /p_site_id:\s*siteId/);
  assert.match(fleetBrowser, />Customer</);
  assert.match(fleetBrowser, />Site</);
  assert.match(fleetBrowser, /Commissioning/);
  assert.match(fleetBrowser, /commissioning_status/);
  assert.match(fleetBrowser, /Ready for field test/);
  assert.doesNotMatch(fleetBrowser, /rows\.filter\(/);
});
