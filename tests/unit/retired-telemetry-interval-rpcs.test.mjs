import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(new URL(name, migrationsUrl), 'utf8'))
  .join('\n');

test('legacy telemetry interval RPCs are not executable by browser roles', () => {
  assert.match(migrations, /revoke execute on function public\.set_telemetry_policy_intervals\(text, integer, integer, integer\) from authenticated/i);
  assert.match(migrations, /revoke execute on function public\.set_telemetry_policy_intervals\(text, integer, integer, integer\) from public, anon/i);
  assert.match(migrations, /grant execute on function public\.set_telemetry_policy_intervals\(text, integer, integer, integer\) to service_role/i);

  assert.match(migrations, /revoke execute on function public\.get_telemetry_policy_intervals\(\) from authenticated/i);
  assert.match(migrations, /revoke execute on function public\.get_telemetry_policy_intervals\(\) from public, anon/i);
  assert.match(migrations, /grant execute on function public\.get_telemetry_policy_intervals\(\) to service_role/i);
});
