import { expect, test } from '@playwright/test';
import { installSupabaseAuthFixture } from './helpers/supabase-auth-fixture.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseOrigin = 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const authUserId = '10000000-0000-4000-8000-000000000512';
const businessUserId = '20000000-0000-4000-8000-000000000512';
const machineId = '30000000-0000-4000-8000-000000000512';
const deviceId = '40000000-0000-4000-8000-000000000512';
const faultId = '50000000-0000-4000-8000-000000000512';

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
    email: 'professional-layout@example.com',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 7200,
  })).toString('base64url');
  const accessToken = `${header}.${payload}.test-signature`;
  return {
    access_token: accessToken,
    refresh_token: 'professional-layout-refresh-token',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    user: {
      id: authUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'professional-layout@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { full_name: 'Professional Layout Tester' },
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
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }));
    if (url.pathname === '/rest/v1/user_details') return route.fulfill(jsonResponse({
      id: 'details-professional-layout',
      user_id: businessUserId,
      first_name: 'Professional',
      last_name: 'Tester',
      phone_number: '0110000000',
      birthday: '1990-01-01',
      role: 'admin',
      branch: 'national',
      telemetry_region: 'south_africa',
      emergency_contact_name: 'Test',
      emergency_contact_phone: '0820000000',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }));
    if (url.pathname === '/rest/v1/rpc/claim_current_app_user') return route.fulfill(jsonResponse(null));

    if (url.pathname === '/rest/v1/machines') return route.fulfill(jsonResponse({
      id: machineId,
      branch: 'johannesburg',
      customer_id: 'customer-layout',
      site_id: 'site-layout',
      asset_tag: 'ASSET-LONG-000512',
      serial_number: 'SERIAL-LONG-IDENTIFIER-000512',
      machine_barcode: 'QR-LONG-IDENTIFIER-000512',
      machine_name: 'Rheavendors Extra Long Machine Display Name For Professional Layout Verification',
      model: 'XS GRANDE E5 PRO',
      status: 'active',
      current_custodian: 'Ground Floor Reception Area With A Long Location Description',
      manufacturer: 'Rheavendors',
      condition: 'good',
      criticality: 'standard',
      installed_at: '2026-01-10T08:00:00.000Z',
      last_service_at: '2026-08-01T08:00:00.000Z',
      next_service_at: '2026-10-01T08:00:00.000Z',
    }));
    if (url.pathname === '/rest/v1/telemetry_devices') return route.fulfill(jsonResponse({
      id: deviceId,
      device_code: 'DLM-ESP32-LONG-DEVICE-CODE-000512',
      status: 'active',
      profile_id: null,
      firmware_version: 'test-layout',
      wifi_rssi: -58,
      cellular_csq: 24,
      cellular_operator: 'Vodacom',
      cellular_model: 'Air780EU',
      last_transport: 'cellular',
      transport_preference: 'cellular',
      telemetry_mode: 'live',
      last_seen_at: new Date().toISOString(),
      last_upload_at: new Date().toISOString(),
      last_counter_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      last_config_at: new Date().toISOString(),
      last_config_ack_at: new Date().toISOString(),
      hardware_uid: 'HARDWARE-UID-EXTRA-LONG-000512',
      reported_machine_serial: 'SERIAL-LONG-IDENTIFIER-000512',
      machine_link_status: 'linked',
      machine_link_method: 'automatic',
    }));
    if (url.pathname === '/rest/v1/customer_sites') return route.fulfill(jsonResponse({
      id: 'site-layout',
      site_name: 'A Very Long Customer Site Name For Professional Layout Verification',
      address: '100 Extremely Long Business Park Road, Johannesburg, Gauteng, South Africa',
      latitude: -26.2041,
      longitude: 28.0473,
    }));
    if (url.pathname === '/rest/v1/customers') return route.fulfill(jsonResponse({ id: 'customer-layout', customer_name: 'Professional Layout Client Company', customer_code: 'PLC001' }));
    if (url.pathname === '/rest/v1/telemetry_fault_events') return route.fulfill(jsonResponse([{
      id: faultId,
      machine_id: machineId,
      device_id: deviceId,
      fault_code: 'VERY_LONG_MACHINE_COMMUNICATION_TIMEOUT_FAULT_CODE',
      severity: 'critical',
      source: 'machine-controller',
      detail: 'Communication timeout reported by the machine controller with a deliberately long operator-facing fault description.',
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      last_seen_at: new Date().toISOString(),
      cleared_at: null,
    }]));
    if (url.pathname === '/rest/v1/telemetry_alarm_workflow') return route.fulfill(jsonResponse([]));
    if (url.pathname === '/rest/v1/telemetry_daily_item_sales') return route.fulfill(jsonResponse([
      { id: 'sale-layout-1', sales_date: '2026-09-25', selection_code: '01', product_key: 'caramel', sku: 'CC01', product_name: 'Caramel Cappuccino With A Long Display Name', brand: 'Dallmayr', units_sold: 17, failed_vends: 1, revenue_cents: 28900, last_received_at: '2026-09-25T08:00:00.000Z' },
    ]));
    if (url.pathname === '/rest/v1/telemetry_counter_state') return route.fulfill(jsonResponse([
      { selection_code: '01', sold_total: 142, failed_total: 3, revenue_cents_total: 241400, updated_at: '2026-09-25T08:00:00.000Z' },
    ]));
    if (url.pathname === '/rest/v1/rpc/get_telemetry_machine_identity') return route.fulfill(jsonResponse({
      machine: { id: machineId, name: 'Rheavendors Extra Long Machine Display Name For Professional Layout Verification', model: 'XS GRANDE E5 PRO', manufacturer: 'Rheavendors', serial_number: 'SERIAL-LONG-IDENTIFIER-000512', asset_tag: 'ASSET-LONG-000512', barcode: 'QR-LONG-IDENTIFIER-000512' },
      device: { id: deviceId, device_code: 'DLM-ESP32-LONG-DEVICE-CODE-000512', reported_serial: 'SERIAL-LONG-IDENTIFIER-000512', reported_model: 'XS GRANDE E5 PRO', reported_revision: null, reported_asset: null, identity_source: 'database_model', profile_fingerprint: null, protocol: 'mdb', identity_at: new Date().toISOString(), machine_link_status: 'linked', machine_link_method: 'manual', profile_id: null, profile_assignment_method: 'automatic', profile_updated_at: null, last_config_ack_at: new Date().toISOString(), applied_profile_id: null },
      profile_options: [],
      recommended_profile: null,
      effective_profile_key: 'RHEAVENDORS XS GRANDE E5 PRO',
      confidence: 'medium',
      conflicts: [],
      evidence: [{ type: 'model', value: 'XS GRANDE E5 PRO' }],
      profile_pending: true,
    }));
    if (url.pathname === '/rest/v1/rpc/get_machine_model_button_map') return route.fulfill(jsonResponse([]));
    if (url.pathname === '/rest/v1/rpc/get_telemetry_data_usage') return route.fulfill(jsonResponse({
      device_id: deviceId,
      request_count: 100,
      application_bytes: 10_000_000,
      device_application_bytes: 12_000_000,
      device_application_sample_count: 30,
      measured_modem_bytes: 15_000_000,
      modem_sample_count: 30,
      projected_monthly_application_bytes: 20_000_000,
      projected_monthly_device_application_bytes: 24_000_000,
      projected_monthly_modem_bytes: 30_000_000,
    }));
    if (url.pathname === '/rest/v1/rpc/get_telemetry_prepaid_balances') return route.fulfill(jsonResponse({ device_id: deviceId, remaining_bytes: 500_000_000, query_status: 'ok', alert_level: 'ok', checked_at: new Date().toISOString(), is_stale: false }));
    if (url.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill(jsonResponse([]));
    if (url.pathname.startsWith('/rest/v1/')) return route.fulfill(jsonResponse([]));
    return route.fulfill(jsonResponse({}));
  });
}

async function openPage(browser, pathname, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await installMock(page);
  await page.goto(`${baseURL}${pathname}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-platform-shell="telemetry-v3"]')).toBeVisible({ timeout: 20_000 });
  return { context, page };
}

test('machine detail uses professional hierarchy and never breaks identifiers by character', async ({ browser }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1180, height: 820 }]) {
    const { context, page } = await openPage(browser, `/machines/${machineId}`, viewport);
    const detail = page.locator('[data-machine-detail="televend-v3"]');
    await expect(detail).toBeVisible({ timeout: 20_000 });
    await expect(detail.getByRole('heading', { level: 1 })).toContainText('Rheavendors');

    const evidence = await detail.evaluate((root) => {
      const heading = root.querySelector(':scope > header:first-child h1');
      const quickActions = root.querySelector(':scope > section[aria-label="Machine quick actions"]');
      const metrics = root.querySelector(':scope > nav[aria-label="Machine dashboard sections"] + section');
      const metricValue = metrics?.querySelector('article strong');
      const detailValue = root.querySelector('article dl dd');
      if (!(heading instanceof HTMLElement) || !(quickActions instanceof HTMLElement) || !(metrics instanceof HTMLElement) || !(metricValue instanceof HTMLElement) || !(detailValue instanceof HTMLElement)) return null;
      return {
        headingFont: Number.parseFloat(getComputedStyle(heading).fontSize),
        headingWordBreak: getComputedStyle(heading).wordBreak,
        actionColumns: getComputedStyle(quickActions).gridTemplateColumns.split(' ').filter(Boolean).length,
        metricColumns: getComputedStyle(metrics).gridTemplateColumns.split(' ').filter(Boolean).length,
        metricWordBreak: getComputedStyle(metricValue).wordBreak,
        metricWhiteSpace: getComputedStyle(metricValue).whiteSpace,
        detailWordBreak: getComputedStyle(detailValue).wordBreak,
        detailWhiteSpace: getComputedStyle(detailValue).whiteSpace,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    expect(evidence).not.toBeNull();
    expect(evidence.headingFont).toBeGreaterThanOrEqual(28);
    expect(evidence.headingWordBreak).not.toBe('break-all');
    expect(evidence.metricColumns).toBe(viewport.width === 1440 ? 3 : 2);
    expect(evidence.metricWordBreak).not.toBe('break-all');
    expect(evidence.metricWhiteSpace).toBe('nowrap');
    expect(evidence.detailWordBreak).not.toBe('break-all');
    expect(evidence.detailWhiteSpace).toBe('nowrap');
    expect(evidence.overflow).toBe(false);

    await context.close();
  }
});

test('alerts uses calm page hierarchy, structured filters and responsive table-to-card transition', async ({ browser }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1180, height: 820 }]) {
    const { context, page } = await openPage(browser, '/alerts', viewport);
    const alerts = page.locator('[data-alarm-center="televend-v3"]');
    await expect(alerts).toBeVisible({ timeout: 20_000 });
    await expect(alerts.getByRole('heading', { name: 'Alerts', level: 1 })).toBeVisible();
    await expect(alerts.getByText('VERY_LONG_MACHINE_COMMUNICATION_TIMEOUT_FAULT_CODE', { exact: true }).first()).toBeVisible();

    const evidence = await alerts.evaluate((root) => {
      const heading = root.querySelector(':scope > header:first-child h1');
      const metrics = root.querySelector(':scope > section[aria-label="Alert status summary"]');
      const filters = root.querySelector(':scope > section[aria-label="Alert filters"]');
      const table = root.querySelector('table');
      const faultStrong = table?.querySelector('tbody td:nth-child(3) strong');
      if (!(heading instanceof HTMLElement) || !(metrics instanceof HTMLElement) || !(filters instanceof HTMLElement) || !(table instanceof HTMLElement)) return null;
      return {
        headingFont: Number.parseFloat(getComputedStyle(heading).fontSize),
        metricColumns: getComputedStyle(metrics).gridTemplateColumns.split(' ').filter(Boolean).length,
        filterColumns: getComputedStyle(filters).gridTemplateColumns.split(' ').filter(Boolean).length,
        tableDisplay: getComputedStyle(table).display,
        tableLayout: getComputedStyle(table).tableLayout,
        faultWordBreak: faultStrong instanceof HTMLElement ? getComputedStyle(faultStrong).wordBreak : null,
        faultWhiteSpace: faultStrong instanceof HTMLElement ? getComputedStyle(faultStrong).whiteSpace : null,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    expect(evidence).not.toBeNull();
    expect(evidence.headingFont).toBeGreaterThanOrEqual(28);
    expect(evidence.metricColumns).toBe(viewport.width === 1440 ? 3 : 2);
    expect(evidence.filterColumns).toBe(viewport.width === 1440 ? 4 : 2);
    if (viewport.width === 1440) {
      expect(evidence.tableDisplay).toBe('table');
      expect(evidence.tableLayout).toBe('fixed');
      expect(evidence.faultWordBreak).not.toBe('break-all');
      expect(evidence.faultWhiteSpace).toBe('nowrap');
    } else {
      expect(evidence.tableDisplay).toBe('none');
    }
    expect(evidence.overflow).toBe(false);

    await context.close();
  }
});
