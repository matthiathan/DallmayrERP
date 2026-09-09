import { expect, test } from '@playwright/test';
import { installSupabaseAuthFixture } from './helpers/supabase-auth-fixture.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseOrigin = 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const authUserId = '10000000-0000-4000-8000-000000000311';
const businessUserId = '20000000-0000-4000-8000-000000000311';

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

function sessionFixture() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: authUserId,
    email: 'machine-detail@example.com',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 7200,
  })).toString('base64url');
  const accessToken = `${header}.${payload}.test-signature`;
  return {
    access_token: accessToken,
    refresh_token: 'machine-detail-refresh-token',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    user: {
      id: authUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'machine-detail@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { full_name: 'Machine Tester' },
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

async function installMock(page) {
  const session = sessionFixture();
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
      id: 'details-machine-detail',
      user_id: businessUserId,
      first_name: 'Machine',
      last_name: 'Tester',
      phone_number: '0110000000',
      birthday: '1990-01-01',
      role: 'admin',
      branch: 'national',
      emergency_contact_name: 'Test',
      emergency_contact_phone: '0820000000',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }));
    if (url.pathname === '/rest/v1/rpc/claim_current_app_user') return route.fulfill(jsonResponse(null));

    if (url.pathname === '/rest/v1/machines') return route.fulfill(jsonResponse({
      id: 'machine-1', branch: 'jhb', customer_id: 'customer-1', site_id: 'site-1', asset_tag: 'AST-001', serial_number: 'BEL-001', machine_barcode: 'QR-BEL-001', machine_name: 'Belluno 01', model: 'Belluno', status: 'active', current_custodian: null, manufacturer: 'Dallmayr', condition: 'good', criticality: 'standard', installed_at: '2026-01-10T08:00:00.000Z', last_service_at: '2026-08-01T08:00:00.000Z', next_service_at: '2026-10-01T08:00:00.000Z',
    }));
    if (url.pathname === '/rest/v1/telemetry_devices') return route.fulfill(jsonResponse({
      id: 'device-1', device_code: 'DALL-TEL-001', status: 'active', profile_id: 'belluno-mdb', firmware_version: '6.8.41', wifi_rssi: -58, cellular_csq: 24, cellular_operator: 'Vodacom', cellular_model: 'Air780EU', last_transport: 'cellular', transport_preference: 'cellular', last_seen_at: new Date().toISOString(), last_upload_at: new Date().toISOString(), last_counter_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString(), last_config_at: new Date().toISOString(), last_config_ack_at: new Date().toISOString(), hardware_uid: 'ESP32S3-TEST-001', reported_machine_serial: 'BEL-001', machine_link_status: 'linked', machine_link_method: 'automatic',
    }));
    if (url.pathname === '/rest/v1/customer_sites') return route.fulfill(jsonResponse({ id: 'site-1', site_name: 'Johannesburg Test Site', address: '1 Test Road, Johannesburg', latitude: -26.2041, longitude: 28.0473 }));
    if (url.pathname === '/rest/v1/customers') return route.fulfill(jsonResponse({ id: 'customer-1', customer_name: 'Test Customer', customer_code: 'TC001' }));
    if (url.pathname === '/rest/v1/telemetry_fault_events') return route.fulfill(jsonResponse([
      { id: 'fault-1', fault_code: 'MDB_TIMEOUT', severity: 'warning', source: 'mdb', detail: 'MDB response delayed', started_at: '2026-09-08T10:00:00.000Z', last_seen_at: '2026-09-09T05:50:00.000Z', cleared_at: null },
    ]));
    if (url.pathname === '/rest/v1/telemetry_daily_item_sales') return route.fulfill(jsonResponse([
      { id: 'sale-1', sales_date: '2026-09-06', selection_code: '01', product_key: 'caramel', sku: 'CC01', product_name: 'Caramel Cappuccino', brand: 'Dallmayr', units_sold: 4, failed_vends: 0, revenue_cents: 6800, last_received_at: '2026-09-06T13:00:00.000Z' },
      { id: 'sale-2', sales_date: '2026-09-07', selection_code: '02', product_key: 'porridge', sku: 'IP01', product_name: 'Instant Porridge', brand: 'Dallmayr', units_sold: 6, failed_vends: 1, revenue_cents: 8400, last_received_at: '2026-09-07T13:00:00.000Z' },
      { id: 'sale-3', sales_date: '2026-09-08', selection_code: '01', product_key: 'caramel', sku: 'CC01', product_name: 'Caramel Cappuccino', brand: 'Dallmayr', units_sold: 7, failed_vends: 0, revenue_cents: 11900, last_received_at: '2026-09-08T13:00:00.000Z' },
      { id: 'sale-4', sales_date: '2026-09-09', selection_code: '03', product_key: 'black', sku: 'BC01', product_name: 'Black Coffee', brand: 'Dallmayr', units_sold: 10, failed_vends: 1, revenue_cents: 15000, last_received_at: '2026-09-09T05:55:00.000Z' },
    ]));
    if (url.pathname === '/rest/v1/telemetry_counter_state') return route.fulfill(jsonResponse([
      { selection_code: '01', sold_total: 142, failed_total: 3, revenue_cents_total: 241400, updated_at: '2026-09-09T05:55:00.000Z' },
      { selection_code: '02', sold_total: 88, failed_total: 2, revenue_cents_total: 123200, updated_at: '2026-09-09T05:55:00.000Z' },
      { selection_code: '03', sold_total: 74, failed_total: 1, revenue_cents_total: 111000, updated_at: '2026-09-09T05:55:00.000Z' },
    ]));
    if (url.pathname === '/rest/v1/rpc/get_telemetry_data_usage') return route.fulfill(jsonResponse({ device_id: 'device-1', request_count: 420, application_bytes: 18_000_000, device_application_bytes: 20_000_000, device_application_sample_count: 30, measured_modem_bytes: 45_000_000, modem_sample_count: 30, projected_monthly_application_bytes: 18_000_000, projected_monthly_device_application_bytes: 20_000_000, projected_monthly_modem_bytes: 45_000_000 }));
    if (url.pathname === '/rest/v1/rpc/get_telemetry_prepaid_balances') return route.fulfill(jsonResponse({ device_id: 'device-1', remaining_bytes: 524_288_000, query_status: 'ok', alert_level: 'ok', checked_at: '2026-09-09T05:55:00.000Z', is_stale: false }));
    if (url.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill(jsonResponse([]));
    if (url.pathname.startsWith('/rest/v1/')) return route.fulfill(jsonResponse([]));
    return route.fulfill(jsonResponse({}));
  });
}

test('rebuilt machine detail workspace exposes telemetry, interactive vends and device diagnostics on mobile', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await installMock(page);
  await page.goto(`${baseURL}/machines/machine-1`, { waitUntil: 'domcontentloaded' });

  const detail = page.locator('[data-machine-detail="televend-v3"]');
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await expect(detail.getByRole('heading', { name: 'Belluno 01', level: 1 })).toBeVisible();
  await expect(detail.getByText('Items sold', { exact: true })).toBeVisible();
  await expect(detail.getByText('Lifetime cups', { exact: true })).toBeVisible();
  await expect(detail.getByText('Data used', { exact: true })).toBeVisible();
  await expect(detail.getByRole('img', { name: /Cellular signal high/i })).toBeVisible();

  const chart = detail.locator('[data-chart-interactive="comparison-line"]');
  await expect(chart).toBeVisible();
  const topPoint = chart.locator('circle[role="button"]').last();
  await topPoint.click();
  await expect(topPoint).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.locator('[data-tooltip-placement]')).toBeVisible();
  await expect(chart.locator('[data-tooltip-placement]')).toContainText('10 vends');

  await detail.getByRole('button', { name: 'Vends & products' }).click();
  const blackCoffeeRows = detail.getByText('Black Coffee', { exact: true });
  await expect(blackCoffeeRows).toHaveCount(2);
  await expect(blackCoffeeRows.last()).toBeVisible();
  await detail.getByRole('button', { name: 'Events' }).click();
  await expect(detail.getByText('MDB_TIMEOUT', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Device' }).click();
  await expect(detail.getByRole('heading', { name: 'DALL-TEL-001' })).toBeVisible();
  await expect(detail.getByText('ESP32S3-TEST-001', { exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    main: Boolean(document.querySelector('#main-content') && document.querySelector('#main-content').scrollWidth > document.querySelector('#main-content').clientWidth),
  }));
  expect(overflow.document).toBe(false);
  expect(overflow.main).toBe(false);

  await context.close();
});
