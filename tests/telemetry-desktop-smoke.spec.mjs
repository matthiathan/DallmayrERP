import { expect, test } from '@playwright/test';
import { installSupabaseAuthFixture } from './helpers/supabase-auth-fixture.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseOrigin = 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const authUserId = '10000000-0000-4000-8000-000000000209';
const businessUserId = '20000000-0000-4000-8000-000000000209';

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
    email: 'telemetry-smoke@example.com',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 7200,
  })).toString('base64url');
  const accessToken = `${header}.${payload}.test-signature`;

  return {
    access_token: accessToken,
    refresh_token: 'telemetry-smoke-refresh-token',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    user: {
      id: authUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'telemetry-smoke@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

async function installAuthenticatedTelemetryMock(page) {
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
        id: 'details-telemetry-smoke',
        user_id: businessUserId,
        first_name: 'Telemetry',
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
    if (url.pathname === '/rest/v1/rpc/get_telemetry_dashboard') {
      await route.fulfill(jsonResponse({ device_states: [], active_faults: [] }));
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

async function openAuthenticatedPage(browser, pathname) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await installAuthenticatedTelemetryMock(page);
  await page.goto(`${baseURL}${pathname}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.application-shell-v2')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('.dallmayr-sidebar')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#main-content')).toHaveCount(1, { timeout: 20_000 });
  return { context, page };
}

test('desktop telemetry shell exposes the current fleet navigation without retired mobile chrome', async ({ browser }) => {
  const { context, page } = await openAuthenticatedPage(browser, '/machines');

  await expect(page.getByRole('heading', { name: 'Machines', level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('a[href="/machines"][aria-current="page"]')).toHaveCount(1);

  for (const href of ['/', '/machines', '/alerts', '/telemetry', '/telemetry/test-center', '/map', '/products', '/telemetry/devices']) {
    await expect(page.locator(`.dallmayr-sidebar-nav a[href="${href}"]`)).toHaveCount(1);
  }

  await expect(page.locator('.mobile-quick-bar')).toHaveCount(0);
  await expect(page.locator('.mobile-nav-portal-root')).toHaveCount(0);
  await expect(page.locator('[aria-controls="mobile-navigation"]')).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);

  await context.close();
});

test('current telemetry management routes keep the desktop shell and canonical active navigation', async ({ browser }) => {
  for (const pathname of ['/products', '/telemetry/test-center', '/telemetry/devices']) {
    const { context, page } = await openAuthenticatedPage(browser, pathname);
    await expect(page).toHaveURL(`${baseURL}${pathname}`);
    await expect(page.locator(`.dallmayr-sidebar a[href="${pathname}"][aria-current="page"]`)).toHaveCount(1);
    await expect(page.locator('.mobile-quick-bar, .mobile-nav-portal-root')).toHaveCount(0);
    await context.close();
  }
});
