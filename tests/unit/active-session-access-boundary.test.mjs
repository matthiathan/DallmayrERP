import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const middleware = fs.readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
const login = fs.readFileSync(new URL('../../app/login/page.tsx', import.meta.url), 'utf8');
const migrationsUrl = new URL('../../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(migrationsUrl)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    content: fs.readFileSync(new URL(name, migrationsUrl), 'utf8'),
  }));

test('protected routes require an active DallmayrERP account, not only a valid Supabase JWT', () => {
  assert.match(middleware, /rpc\(['"]is_active_app_user['"]\)/);
  assert.match(middleware, /activeAppUser/);
  assert.match(middleware, /authenticated\s*&&\s*activeAppUser/);
});

test('login rejects authenticated accounts without active application access', () => {
  assert.match(login, /rpc\(['"]is_active_app_user['"]\)/);
  assert.match(login, /auth\.signOut\(\)/);
  assert.match(login, /active DallmayrERP access|active DallmayrERP account/i);
});

test('current_app_user_id fails closed for suspended application users', () => {
  const hardeningMigration = migrations.find(({ content }) =>
    /create\s+or\s+replace\s+function\s+public\.current_app_user_id\s*\(\s*\)/i.test(content)
    && /u\.is_active\s*=\s*true/i.test(content),
  );

  assert.ok(hardeningMigration, 'A migration must redefine current_app_user_id() to require users.is_active = true');
});
