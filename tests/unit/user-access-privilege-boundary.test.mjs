import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationDir = new URL('../../supabase/migrations/', import.meta.url);

async function migration() {
  const files = await readdir(migrationDir);
  const name = files.find((file) => file.endsWith('_lock_down_user_access_records.sql'));
  assert.ok(name, 'A dedicated user-access lock-down migration must exist');
  return readFile(new URL(name, migrationDir), 'utf8');
}

test('ordinary users cannot insert update or delete their own trusted access record', async () => {
  const sql = await migration();
  for (const policy of [
    'user_details_insert_own_or_admin',
    'user_details_update_own_or_admin',
    'user_details_delete_own_or_admin',
  ]) {
    assert.match(sql, new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${policy}\\s+on\\s+public\\.user_details`, 'i'));
  }

  assert.match(sql, /create\s+policy\s+user_details_insert_admin\s+on\s+public\.user_details[\s\S]*?for\s+insert[\s\S]*?to\s+authenticated[\s\S]*?with\s+check\s*\(\s*public\.current_app_role\(\)\s*=\s*'admin'\s*\)/i);
  assert.match(sql, /create\s+policy\s+user_details_update_admin\s+on\s+public\.user_details[\s\S]*?for\s+update[\s\S]*?to\s+authenticated[\s\S]*?using\s*\(\s*public\.current_app_role\(\)\s*=\s*'admin'\s*\)[\s\S]*?with\s+check\s*\(\s*public\.current_app_role\(\)\s*=\s*'admin'\s*\)/i);
  assert.match(sql, /create\s+policy\s+user_details_delete_admin\s+on\s+public\.user_details[\s\S]*?for\s+delete[\s\S]*?to\s+authenticated[\s\S]*?using\s*\(\s*public\.current_app_role\(\)\s*=\s*'admin'\s*\)/i);
});

test('self profile reads remain available without widening them to other users', async () => {
  const sql = await migration();
  assert.doesNotMatch(sql, /drop\s+policy\s+(?:if\s+exists\s+)?user_details_select_own_or_admin/i);
  assert.match(sql, /comment\s+on\s+table\s+public\.user_details[\s\S]*?self-read/i);
});

test('controlled security-definer access paths remain the authority for non-admin self changes', async () => {
  const sql = await migration();
  assert.match(sql, /set_my_telemetry_region/i);
  assert.match(sql, /admin_(?:create|update|delete)_user_access/i);
});
