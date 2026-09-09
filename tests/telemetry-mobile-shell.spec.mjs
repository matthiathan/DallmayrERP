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
      'content-range': '0-0/1',
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

function telemetryReportFixture() {
  return {
    period: 'month',
    dataset: 'production',
    date_from: '2026-09-06',
    date_to: '2026-09-09',
    availability: { production_rows: 4, simulation_rows: 0, active_simulation_devices: 0 },
    summary: {
      units_sold: 29,
      revenue_cents: 48_300,
      failed_vends: 3,
      active_machines: 3,
      reporting_devices: 3,
      online_devices: 2,
      offline_devices: 1,
      unassigned_devices: 0,
    },
    daily_trend: [
      { date: '2026-09-06', units_sold: 5, failed_vends: 1, revenue_cents: 8_200 },
      { date: '2026-09-07', units_sold: 8, failed_vends: 0, revenue_cents: 13_200 },
      { date: '2026-09-08', units_sold: 7, failed_vends: 1, revenue_cents: 11_900 },
      { date: '2026-09-09', units_sold: 9, failed_vends: 1, revenue_cents: 15_000 },
    ],
    by_branch: [
      { branch: 'jhb', units_sold: 18, failed_vends: 2, revenue_cents: 30_100 },
      { branch: 'cpt', units_sold: 11, failed_vends: 1, revenue_cents: 18_200 },
    ],
    top_items: [
      { product_key: 'coffee-caramel', sku: 'CC01', product_name: 'Caramel Cappuccino', brand: 'Dallmayr', units_sold: 12, failed_vends: 1, revenue_cents: 20_400 },
      { product_key: 'porridge-instant', sku: 'IP01', product_name: 'Instant Porridge', brand: 'Dallmayr', units_sold: 9, failed_vends: 0, revenue_cents: 12_600 },
    ],
    top_machines: [
      { machine_id: 'machine-1', machine_name: 'Belluno 01', serial_number: 'BEL-001', location: 'Johannesburg', branch: 'jhb', units_sold: 18, failed_vends: 2, revenue_cents: 30_100 },
      { machine_id: 'machine-2', machine_name: 'Belluno 02', serial_number: 'BEL-002', location: 'Cape Town', branch: 'cpt', units_sold: 11, failed_vends: 1, revenue_cents: 18_200 },
    ],
    recent_sales: [
      { id: 'sale-1', sales_date: '2026-09-09', machine_name: 'Belluno 01', serial_number: 'BEL-001', location: 'Johannesburg', branch: 'jhb', selection_code: '01', sku: 'CC01', product_name: 'Caramel Cappuccino', units_sold: 3, failed_vends: 0, revenue_cents: 5_100, last_received_at: '2026-09-09T07:55:00.000Z' },
    ],
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

    if (request.method() === 'OPTIONS') return route.fulfill(jsonResponse(null, 204));
    if (url.pathname === '/auth/v1/user') return route.fulfill(jsonResponse(session.user));
    if (url.pathname.startsWith('/auth/v1/token')) return route.fulfill(jsonResponse(session));
    if (url.pathname === '/rest/v1/users') return route.fulfill(jsonResponse({
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
    if (url.pathname === '/rest/v1/user_details') return route.fulfill(jsonResponse({
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
    if (url.pathname === '/rest/v1/rpc/claim_current_app_user') return route.fulfill(jsonResponse(null));
    if (url.pathname === '/rest/v1/rpc/get_telemetry_reporting') return route.fulfill(jsonResponse(telemetryReportFixture()));
    if (url.pathname === '/rest/v1/rpc/get_telemetry_dashboard') return route.fulfill(jsonResponse({ device_states: [], active_faults: [] }));
    if (url.pathname === '/rest/v1/rpc/get_telemetry_data_usage') return route.fulfill(jsonResponse([]));
    if (url.pathname === '/rest/v1/rpc/get_telemetry_prepaid_balances') return route.fulfill(jsonResponse([]));
    if (url.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill(jsonResponse([]));
    if (url.pathname.startsWith('/rest/v1/')) return route.fulfill(jsonResponse([]));
    return route.fulfill(jsonResponse({}));
  });
}

async function openResponsivePage(browser, pathname, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await installAuthenticatedTelemetryMock(page);
  await page.goto(`${baseURL}${pathname}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-platform-shell="telemetry-v3"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('[data-mobile-shell="v1"]')).toBeVisible({ timeout: 20_000 });
  return { context, page };
}

async function expectMobilePageTitle(page, title) {
  const header = page.locator('.telemetry-mobile-header');
  await expect(header).toBeVisible({ timeout: 20_000 });
  await expect(header.getByText(title, { exact: true }).first()).toBeVisible();
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    main: Boolean(document.querySelector('#main-content') && document.querySelector('#main-content').scrollWidth > document.querySelector('#main-content').clientWidth),
  }));
  expect(overflow.document).toBe(false);
  expect(overflow.main).toBe(false);
}

test('mobile telemetry shell exposes the four primary fleet routes without desktop chrome', async ({ browser }) => {
  const { context, page } = await openResponsivePage(browser, '/machines');
  await expect(page.locator('.application-header')).toBeHidden();
  await expect(page.locator('.dallmayr-sidebar')).toBeHidden();
  await expectMobilePageTitle(page, 'Machines');
  await expect(page.locator('.telemetry-mobile-bottom-nav')).toBeVisible();
  await expect(page.locator('.telemetry-mobile-bottom-nav a[href="/machines"]')).toHaveAttribute('aria-current', 'page');
  for (const href of ['/', '/machines', '/alerts', '/telemetry']) {
    await expect(page.locator(`.telemetry-mobile-bottom-nav a[href="${href}"]`)).toHaveCount(1);
  }
  await expect(page.locator('#mobile-account-menu-target')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await context.close();
});

test('rebuilt Fleet Overview and Machines remain bounded on a phone', async ({ browser }) => {
  const home = await openResponsivePage(browser, '/');
  const dashboard = home.page.locator('[data-fleet-dashboard="televend-v3"]');
  await expect(dashboard).toBeVisible({ timeout: 20_000 });
  await expectMobilePageTitle(home.page, 'Fleet Overview');
  await expect(dashboard.getByText('Items sold', { exact: true }).first()).toBeVisible();
  await expect(dashboard.getByRole('heading', { name: 'Sales metrics' })).toBeVisible();
  await expect(dashboard.locator('[data-chart-interactive="comparison-line"]')).toBeVisible();
  await expectNoHorizontalOverflow(home.page);
  await home.context.close();

  const machines = await openResponsivePage(browser, '/machines');
  const browserRoot = machines.page.locator('[data-machine-browser="televend-v3"]');
  await expect(browserRoot).toBeVisible({ timeout: 20_000 });
  await expectMobilePageTitle(machines.page, 'Machines');
  await expect(browserRoot.getByRole('searchbox', { name: 'Search machines' })).toBeVisible();
  await expect(browserRoot.getByText('Online', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(machines.page);
  await machines.context.close();
});

test('rebuilt Analytics comparison chart supports tap-to-pin detail on mobile', async ({ browser }) => {
  const { context, page } = await openResponsivePage(browser, '/telemetry');
  const analytics = page.locator('[data-analytics="televend-v3"]');
  await expect(analytics).toBeVisible({ timeout: 20_000 });
  await expectMobilePageTitle(page, 'Analytics');
  const chart = analytics.locator('[data-chart-interactive="comparison-line"]');
  await expect(chart).toBeVisible();
  const point = chart.locator('circle[role="button"]').last();
  await point.click();
  await expect(point).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.locator('[data-tooltip-placement]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await context.close();
});

test('specialist telemetry workspaces remain usable and bounded on a phone', async ({ browser }) => {
  const routes = [
    ['/telemetry/test-center', 'Test Center'],
    ['/map', 'Machine Map'],
    ['/products', 'Products'],
    ['/telemetry/devices', 'Device Management'],
  ];

  for (const [pathname, mobileTitle] of routes) {
    const { context, page } = await openResponsivePage(browser, pathname);
    const workspace = page.locator('[data-specialist-workspace="televend-v3"]');
    await expect(workspace).toBeVisible({ timeout: 20_000 });
    await expectMobilePageTitle(page, mobileTitle);
    await expectNoHorizontalOverflow(page);
    await context.close();
  }
});

test('mobile More sheet exposes every telemetry route and announces the active secondary route', async ({ browser }) => {
  const { context, page } = await openResponsivePage(browser, '/machines');
  const more = page.getByRole('button', { name: 'More' });
  await more.click();
  const dialog = page.getByRole('dialog', { name: 'Telemetry navigation' });
  await expect(dialog).toBeVisible();

  for (const href of ['/', '/machines', '/alerts', '/telemetry', '/telemetry/test-center', '/map', '/products', '/telemetry/devices']) {
    await expect(dialog.locator(`a[href="${href}"]`)).toHaveCount(1);
  }

  await dialog.locator('a[href="/products"]').click();
  await expect(page).toHaveURL(`${baseURL}/products`);
  await expect(page.locator('.telemetry-mobile-menu-layer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'page');
  await context.close();
});

test('touch tablet layouts use the mobile telemetry authority at 768, 1024 and 1366 widths', async ({ browser }) => {
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1024, height: 1366 },
    { width: 1366, height: 1024 },
  ]) {
    const { context, page } = await openResponsivePage(browser, '/', viewport);
    await expect(page.locator('[data-fleet-dashboard="televend-v3"]')).toBeVisible({ timeout: 20_000 });
    await expectMobilePageTitle(page, 'Fleet Overview');
    await expect(page.locator('.application-header')).toBeHidden();
    await expect(page.locator('.dallmayr-sidebar')).toBeHidden();
    await expect(page.locator('.telemetry-mobile-bottom-nav')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await context.close();
  }
});
