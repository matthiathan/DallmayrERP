import { expect, test } from '@playwright/test';
import { installSupabaseAuthFixture } from './helpers/supabase-auth-fixture.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseOrigin = 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const authUserId = '10000000-0000-4000-8000-000000000093';
const businessUserId = '20000000-0000-4000-8000-000000000093';

function jsonResponse(data, status = 200, headers = {}) {
  return {
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, range',
      'access-control-allow-methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      ...headers,
    },
    body: JSON.stringify(data),
  };
}

function makeSession() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: authUserId,
    email: 'design-system-test@example.com',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 7200,
  })).toString('base64url');
  const accessToken = `${header}.${payload}.test-signature`;

  return {
    access_token: accessToken,
    refresh_token: 'design-system-test-refresh-token',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    user: {
      id: authUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'design-system-test@example.com',
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
        id: 'details-design-system-test',
        user_id: businessUserId,
        first_name: 'Design',
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
      if (request.method() === 'HEAD') {
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-allow-origin': '*',
            'content-range': '0-0/0',
          },
          body: '',
        });
        return;
      }
      await route.fulfill(jsonResponse([]));
      return;
    }

    await route.fulfill(jsonResponse({}));
  });
}

async function waitForShell(page, route) {
  await expect(page.locator('.application-shell-v2')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('#main-content')).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?.*)?$`), { timeout: 20_000 });
}

const routes = [
  ['/operations/service-jobs', 'Scheduled Call Log', 'operational'],
  ['/operations/deliveries', 'Delivery Board', 'operational'],
  ['/operations/assets', 'Machine Assets', 'list'],
  ['/executive/reports', 'Executive Reports', 'dashboard'],
];

test('core route shells render through canonical ErpLayout page primitives', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();
  await installAuthenticatedShellMock(page);

  for (const [route, title, variant] of routes) {
    await page.goto(`${baseURL}${route}`, { waitUntil: 'domcontentloaded' });
    await waitForShell(page, route);

    const canonicalPage = page.locator(`#main-content > .erp-page[data-erp-page="${variant}"]`);
    const canonicalHeader = canonicalPage.locator(':scope > .erp-page-header');

    await expect(canonicalPage).toHaveCount(1);
    await expect(canonicalHeader).toHaveCount(1);
    await expect(canonicalHeader.locator('h1')).toHaveText(title);
    await expect(page.locator('#main-content > .page-header')).toHaveCount(0);
  }

  await context.close();
});
