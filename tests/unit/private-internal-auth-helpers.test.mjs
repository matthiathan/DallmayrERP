import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(new URL(name, migrationsUrl), 'utf8'))
  .join('\n');

const privateHelpers = [
  ['current_app_account_scope', ''],
  ['require_app_role', 'text\\[\\]'],
  ['telemetry_region_allows_machine', 'uuid'],
];

test('internal authorization helpers are not directly executable by browser roles', () => {
  for (const [name, args] of privateHelpers) {
    const signature = `public\\.${name}\\(${args}\\)`;
    assert.match(migrations, new RegExp(`revoke execute on function ${signature} from authenticated`, 'i'));
    assert.match(migrations, new RegExp(`revoke execute on function ${signature} from public, anon`, 'i'));
    assert.match(migrations, new RegExp(`grant execute on function ${signature} to service_role`, 'i'));
  }
});
