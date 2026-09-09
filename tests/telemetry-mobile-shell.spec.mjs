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

function telemetryReportFixture() {
  return {
    period: 'month',
    dataset: 'production',
    date_from: '2026-08-11',
    date_to: '2026-09-09',
    availability: { production_rows: 4, simulation_rows: 0, active_simulation_devices: 0 },
    summary: {
      units_sold: 29,
      revenue_cents: 48300,
      failed_vends: 3,
      active_machines: 3,
      reporting_devices: 3,
      online_devices: 2,
      offline_devices: 1,
      unassigned_devices: 0,
    },
    daily_trend: [
      { date: '2026-09-06', units_sold: 5, failed_vends: 1, revenue_cents: 8200 },
      { date: '2026-09-07', units_sold: 8, failed_vends: 0, revenue_cents: 13200 },
      { date: '2026-09-08', units_sold: 7, failed_vends: 1, revenue_cents: 11900 },
      { date: '2026-09-09', units_sold: 9, failed_vends: 1, revenue_cents: 15000 },
    ],
    by_branch: [
      { branch: 'jhb', units_sold: 18, failed_vends: 2, revenue_cents: 30100 },
      { branch: 'cpt', units_sold: 11, failed_vends: 1, revenue_cents: 18200 },
    ],
    top_items: [
      { product_key: 'coffee-caramel', sku: 'CC01', product_name: 'Caramel Cappuccino', brand: 'Dallmayr', units_sold: 12, failed_vends: 1, revenue_cents: 20400 },
      { product_key: 'porridge-instant', sku: 'IP01', product_name: 'Instant Porridge', brand: 'Dallmayr', units_sold: 9, failed_vends: 0, revenue_cents: 12600 },
      { product_key: 'coffee-black', sku: 'BC01', product_name: 'Black Coffee', brand: 'Dallmayr', units_sold: 8, failed_vends: 2, revenue_cents: 15300 },
    ],
    top_machines: [
      { machine_id: 'machine-1', machine_name: 'Belluno 01', serial_number: 'BEL-001', location: 'Johannesburg', branch: 'jhb', units_sold: 14, failed_vends: 2, revenue_cents: 23400 },
      { machine_id: 'machine-2', machine_name: 'Belluno 02', serial_number: 'BEL-002', location: 'Cape Town', branch: 'cpt', units_sold: 9, failed_vends: 1, revenue_cents: 14600 },
      { machine_id: 'machine-3', machine_name: 'Belluno 03', serial_number: 'BEL-003', location: 'Johannesburg', branch: 'jhb', units_sold: 6, failed_vends: 0, revenue_cents: 10300 },
    ],
    recent_sales: [],
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
    if (url.pathname === '/rest/v1/rpc/get_telemetry_reporting') {
      await route.fulfill(jsonResponse(telemetryReportFixture()));
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

test('visual Fleet Overview and Machines stay inside the phone viewport', async ({ browser }) => {
  const home = await openMobilePage(browser, '/');
  await expect(home.page.getByRole('heading', { name: 'Mobile, here is the fleet right now.', level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(home.page.getByText('Items sold', { exact: true }).first()).toBeVisible();
  await expect(home.page.getByText('Fleet availability', { exact: true }).first()).toBeVisible();
  await expect(home.page.locator('[data-chart-interactive="line"]')).toBeVisible();
  await expect(home.page.locator('[data-chart-interactive="bar"]')).toHaveCount(3);
  const homeOverflow = await home.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(homeOverflow).toBe(false);
  await home.context.close();

  const machines = await openMobilePage(browser, '/machines');
  await expect(machines.page.locator('.fleet-page-heading')).toBeVisible({ timeout: 20_000 });
  await expect(machines.page.getByRole('heading', { name: 'Machines', level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(machines.page.locator('.fleet-metric-grid')).toBeVisible({ timeout: 20_000 });
  await expect(machines.page.locator('.fleet-table-panel')).toBeVisible({ timeout: 20_000 });
  await expect(machines.page.locator('.fleet-filters')).toBeVisible({ timeout: 20_000 });
  const machineOverflow = await machines.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(machineOverflow).toBe(false);
  await machines.context.close();
});

test('Telemetry Analytics charts support tap-to-pin details on mobile', async ({ browser }) => {
  const { context, page } = await openMobilePage(browser, '/telemetry');

  await expect(page.getByRole('heading', { name: 'Telemetry analytics', level: 1 })).toBeVisible({ timeout: 20_000 });
  const lineChart = page.locator('[data-chart-interactive="line"]');
  const barCharts = page.locator('[data-chart-interactive="bar"]');
  const donutChart = page.locator('[data-chart-interactive="donut"]');
  await expect(lineChart).toBeVisible();
  await expect(barCharts).toHaveCount(3);
  await expect(donutChart).toBeVisible();

  const firstPoint = lineChart.locator('circle[role="button"]').first();
  await firstPoint.click();
  await expect(firstPoint).toHaveAttribute('aria-pressed', 'true');
  await expect(lineChart.getByRole('status')).toContainText('Failed vends');

  const firstBar = barCharts.first().getByRole('button').first();
  await firstBar.click();
  await expect(firstBar).toHaveAttribute('aria-pressed', 'true');
  await expect(barCharts.first().getByRole('status')).toContainText('JHB');

  const firstLegendItem = donutChart.getByRole('button').first();
  await firstLegendItem.click();
  await expect(firstLegendItem).toHaveAttribute('aria-pressed', 'true');
  await expect(donutChart.getByRole('status')).toContainText('Online');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await context.close();
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
