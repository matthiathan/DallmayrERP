import { expect, test } from '@playwright/test';
import { installSupabaseAuthFixture } from './helpers/supabase-auth-fixture.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseOrigin = 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const authUserId = '10000000-0000-4000-8000-000000000093';
const businessUserId = '20000000-0000-4000-8000-000000000093';

function jsonResponse(data, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    },
    body: JSON.stringify(data),
  };
}

function makeSession() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: authUserId,
    email: 'page-navigation-test@example.com',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 7200,
  })).toString('base64url');
  const accessToken = `${header}.${payload}.test-signature`;

  return {
    access_token: accessToken,
    refresh_token: 'page-navigation-test-refresh-token',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    user: {
      id: authUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'page-navigation-test@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

async function installAuthenticatedShellMock(page) {
  const session = makeSession();

  await installSupabaseAuthFixture(page, baseURL, session);

  await page.addInitScript((storedSession) => {
    window.localStorage.setItem('dallmayrerp-auth-persistence', 'device');
    window.localStorage.setItem('dallmayrerp-supabase-auth', JSON.stringify(storedSession));
  }, session);

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') {
      await route.fulfill(jsonResponse(null, 204));
      return;
    }
    if (url.pathname === '/auth/v1/user') {
      await route.fulfill(jsonResponse(session.user));
      return;
    }
    if (url.pathname.startsWith('/auth/v1/token')) {
      await route.fulfill(jsonResponse(session));
      return;
    }
    if (url.pathname === '/rest/v1/users') {
      await route.fulfill(jsonResponse({
        id: businessUserId,
        auth_user_id: authUserId,
        email: session.user.email,
        is_active: true,
        access_note: null,
        access_updated_by: null,
        access_updated_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }));
      return;
    }
    if (url.pathname === '/rest/v1/user_details') {
      await route.fulfill(jsonResponse({
        id: 'details-page-navigation-test',
        user_id: businessUserId,
        first_name: 'Navigation',
        last_name: 'Tester',
        phone_number: '0110000000',
        birthday: '1990-01-01',
        role: 'admin',
        branch: 'national',
        emergency_contact_name: 'Test Contact',
        emergency_contact_phone: '0820000000',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/claim_current_app_user') {
      await route.fulfill(jsonResponse(null));
      return;
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      await route.fulfill(jsonResponse([]));
      return;
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      await route.fulfill(jsonResponse([]));
      return;
    }

    await route.fulfill(jsonResponse({}));
  });
}

async function waitForStableShell(page) {
  await expect(page.locator('.application-shell-v2')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByRole('main')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Scheduled Call Log', level: 1 })).toBeVisible({ timeout: 20_000 });
}

test('mobile page index uses only explicitly declared stable section targets', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await installAuthenticatedShellMock(page);
  await page.goto(`${baseURL}/operations/service-jobs`, { waitUntil: 'domcontentloaded' });
  await waitForStableShell(page);

  const index = page.getByRole('navigation', { name: 'On this page' });
  await expect(index).toBeVisible();
  const links = index.getByRole('link');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveText('Overview');
  await expect(links.nth(0)).toHaveAttribute('href', '#service-job-overview');
  await expect(links.nth(1)).toHaveText('Service workspace');
  await expect(links.nth(1)).toHaveAttribute('href', '#service-job-workspace');
  await expect(page.locator('#service-job-overview')).toHaveCount(1);
  await expect(page.locator('#service-job-workspace')).toHaveCount(1);

  await links.nth(1).click();
  await expect(page).toHaveURL(/#service-job-workspace$/);

  await context.close();
});
