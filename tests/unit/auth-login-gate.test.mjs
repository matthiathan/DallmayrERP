import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { applyAuthCookiePersistence } from '../../lib/supabase/authPersistence.ts';

const middleware = fs.readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../../lib/supabase/client.ts', import.meta.url), 'utf8');
const login = fs.readFileSync(new URL('../../app/login/page.tsx', import.meta.url), 'utf8');
const reset = fs.readFileSync(new URL('../../app/reset-password/page.tsx', import.meta.url), 'utf8');
const accountMenu = fs.readFileSync(new URL('../../components/layout/GlobalAccountMenu.tsx', import.meta.url), 'utf8');

test('server middleware validates Supabase claims before protected pages render', () => {
  assert.match(middleware, /createServerClient/);
  assert.match(middleware, /supabase\.auth\.getClaims\(\)/);
  assert.doesNotMatch(middleware, /supabase\.auth\.getSession\(\)/);
  assert.match(middleware, /PUBLIC_AUTH_ROUTES = \['\/login', '\/reset-password'\]/);
  assert.match(middleware, /loginUrl\.pathname = '\/login'/);
  assert.match(middleware, /loginUrl\.searchParams\.set\('next'/);
  assert.match(middleware, /redirectWithSession/);
  assert.match(middleware, /destination\.origin !== origin/);
});

test('browser auth uses the same cookie session that middleware can validate', () => {
  assert.match(client, /createBrowserClient/);
  assert.match(client, /parseCookieHeader\(document\.cookie\)/);
  assert.match(client, /serializeCookieHeader/);
  assert.match(client, /applyAuthCookiePersistence/);
  assert.doesNotMatch(client, /createClient\(url, publicKey/);
});

test('remember-me cookie handling preserves deletions and expires session-only login on browser close', () => {
  assert.deepEqual(
    applyAuthCookiePersistence({ path: '/', maxAge: 3600 }, false),
    { path: '/' },
  );
  assert.deepEqual(
    applyAuthCookiePersistence({ path: '/', maxAge: 0 }, false),
    { path: '/', maxAge: 0 },
  );
  assert.deepEqual(
    applyAuthCookiePersistence({ path: '/', maxAge: 3600 }, true),
    { path: '/', maxAge: 3600 },
  );
});

test('login includes account creation, recovery, safe return and sign-out support', () => {
  assert.match(login, /signInWithPassword/);
  assert.match(login, /signUp/);
  assert.match(login, /resetPasswordForEmail/);
  assert.match(login, /requested\.startsWith\('\/\/'\)/);
  assert.match(login, /destination\.origin !== window\.location\.origin/);
  assert.match(login, /router\.replace\(loginDestination\(\)\)/);
  assert.match(reset, /exchangeCodeForSession/);
  assert.match(reset, /updateUser\(\{ password: newPassword \}\)/);
  assert.match(accountMenu, /auth\.signOut\(\)/);
});
