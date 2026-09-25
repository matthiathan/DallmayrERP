import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20260925084000_lock_client_tenant_helper_execute.sql', import.meta.url),
  'utf8',
);

test('client tenant helper functions are not anonymously executable', () => {
  assert.match(migration, /revoke all on function public\.telemetry_account_allows_fault\(uuid\) from public, anon/);
  assert.match(migration, /revoke all on function public\.telemetry_account_allows_session\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.telemetry_account_allows_fault\(uuid\) to authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.telemetry_account_allows_session\(uuid\) to authenticated, service_role/);
});
