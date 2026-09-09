import { expect, test } from '@playwright/test';
import { installSupabaseAuthFixture } from './helpers/supabase-auth-fixture.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseOrigin = 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const authUserId = '10000000-0000-4000-8000-000000000210';
const businessUserId = '20000000-0000-4000-8000-000000000210';

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
    email: 'telemetry-mobile@example.com',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 7200,
  })).toString('base64url');
  const accessToken = `${header}.${payload}.test-signature`;

  return {
    access_token: accessToken,
    refresh_token: 'telemetry-mobile-refresh-token',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    user: {
      id: authUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'telemetry-mobile@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { full_name: 'Mobile Telemetry Tester' },
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
        id: 'details-telemetry-mobile',
        user_id: businessUserId,
        first_name: 'Mobile',
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

async function openMobilePage(browser, pathname) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await installAuthenticatedTelemetryMock(page);
  await page.goto(`${baseURL}${pathname}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.application-shell-v2')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('[data-mobile-shell="v1"]')).toBeVisible({ timeout: 20_000 });
  return { context, page };
}

test('new mobile telemetry shell exposes primary fleet navigation without rendering the desktop chrome', async ({ browser }) => {
  const { context, page } = await openMobilePage(browser, '/machines');

  await expect(page.locator('.application-header')).toBeHidden();
  await expect(page.locator('.dallmayr-sidebar')).toBeHidden();
  await expect(page.locator('.telemetry-mobile-header')).toBeVisible();
  await expect(page.locator('.telemetry-mobile-bottom-nav')).toBeVisible();
  await expect(page.locator('.telemetry-mobile-bottom-nav a[href="/machines"]')).toHaveAttribute('aria-current', 'page');

  for (const href of ['/', '/machines', '/alerts', '/telemetry']) {
    await expect(page.locator(`.telemetry-mobile-bottom-nav a[href="${href}"]`)).toHaveCount(1);
  }

  await expect(page.locator('#mobile-account-menu-target')).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);

  await context.close();
});

test('Fleet Overview and Machines stay inside the phone viewport with mobile page-family layout', async ({ browser }) => {
  for (const [pathname, heading] of [['/', 'Good morning, Mobile'], ['/machines', 'Machines']]) {
    const { context, page } = await openMobilePage(browser, pathname);

    await expect(page.locator('.fleet-page-heading')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.fleet-metric-grid')).toBeVisible({ timeout: 20_000 });

    if (pathname === '/machines') {
      await expect(page.locator('.fleet-table-panel')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.fleet-filters')).toBeVisible({ timeout: 20_000 });
    }

    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      main: document.querySelector('#main-content')?.scrollWidth > document.querySelector('#main-content')?.clientWidth,
    }));
    expect(overflow.document).toBe(false);
    expect(overflow.main).toBe(false);

    await context.close();
  }
});

test('new mobile More sheet exposes every telemetry route and closes after navigation', async ({ browser }) => {
  const { context, page } = await openMobilePage(browser, '/machines');

  await page.getByRole('button', { name: 'More' }).click();
  const dialog = page.getByRole('dialog', { name: 'Telemetry navigation' });
  await expect(dialog).toBeVisible();

  for (const href of ['/', '/machines', '/alerts', '/telemetry', '/telemetry/test-center', '/map', '/products', '/telemetry/devices']) {
    await expect(dialog.locator(`a[href="${href}"]`)).toHaveCount(1);
  }

  await dialog.locator('a[href="/products"]').click();
  await expect(page).toHaveURL(`${baseURL}/products`);
  await expect(page.locator('.telemetry-mobile-menu-layer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More' })).toHaveClass(/is-active/);

  await context.close();
});
