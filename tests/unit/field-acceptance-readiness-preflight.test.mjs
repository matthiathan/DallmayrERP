import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('field acceptance readiness is trusted-profile and mapping gated', async () => {
  const names = (await readdir(new URL('../../supabase/migrations/', import.meta.url))).filter((name) => name.endsWith('.sql')).sort();
  const migrations = (await Promise.all(names.map((name) => read(`supabase/migrations/${name}`)))).join('\n');
  assert.match(migrations, /get_telemetry_field_acceptance_readiness/);
  assert.match(migrations, /assert_telemetry_region_selected/);
  assert.match(migrations, /is_active_app_user/);
  assert.match(migrations, /Instant Porridge/i);
  assert.match(migrations, /Caramel Cappuccino/i);
  assert.match(migrations, /other_mapped_product_count/);
  assert.match(migrations, /ready_for_acceptance/);
  assert.match(migrations, /revoke execute on function public\.get_telemetry_field_acceptance_readiness\(uuid\) from public, anon/i);
});

test('field acceptance panel visibly separates mapping setup from evidence capture', async () => {
  const panel = await read('components/features/TelemetryFieldAcceptance.tsx');
  assert.match(panel, /get_telemetry_field_acceptance_readiness/);
  assert.match(panel, /Mapping setup required/);
  assert.match(panel, /Use Learn Mode/i);
  assert.match(panel, /ready_for_acceptance/);
  assert.match(panel, /Instant Porridge/);
  assert.match(panel, /Caramel Cappuccino/);
});
