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
  ['admin_update_user_access', 'uuid, text, text, boolean, text'],
  ['resolve_effective_telemetry_profile_key', 'uuid, uuid'],
  ['resolve_mapped_product_name', 'uuid, uuid, text'],
  ['resolve_mapped_product_name', 'uuid, text'],
];

test('internal resolver and legacy admin helpers are not directly executable by browser roles', () => {
  for (const [name, args] of privateHelpers) {
    const signature = `public\\.${name}\\(${args.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`;
    assert.match(migrations, new RegExp(`revoke execute on function ${signature} from authenticated`, 'i'));
    assert.match(migrations, new RegExp(`revoke execute on function ${signature} from public, anon`, 'i'));
    assert.match(migrations, new RegExp(`grant execute on function ${signature} to service_role`, 'i'));
  }
});
