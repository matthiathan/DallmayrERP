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

function machineFleetFixture() {
  return {
    rows: [{
      id: '30000000-0000-4000-8000-000000000209',
      branch: 'johannesburg',
      site_id: '40000000-0000-4000-8000-000000000209',
      serial_number: 'SERIAL-2026-EXTRA-LONG-IDENTIFIER-000209',
      machine_barcode: 'QR-EXTRA-LONG-000209',
      asset_tag: 'ASSET-000209',
      machine_name: 'Very Long Professional Test Machine Name That Must Never Break One Character Per Line',
      model: 'XS GRANDE E5 PRO',
      asset_status: 'active',
      current_custodian: null,
      manufacturer: 'Rheavendors',
      site_name: 'Long Customer Site Name For Layout Verification',
      location: 'Ground Floor Reception Area With A Long Location Description',
      device_id: '50000000-0000-4000-8000-000000000209',
      device_code: 'DLM-ESP32-LONGDEVICE000209',
      telemetry_mode: 'live',
      machine_status: 'active',
      last_transport: 'cellular',
      wifi_rssi: null,
      cellular_csq: 24,
      cellular_operator: 'Vodacom',
      firmware_version: 'test-ui-fixture',
      last_seen_at: '2026-09-25T08:00:00.000Z',
      last_heartbeat_at: '2026-09-25T08:00:00.000Z',
      profile_id: null,
      effective_profile_key: 'RHEAVENDORS XS GRANDE E5 PRO',
      applied_profile_key: null,
      profile_resolution: 'automatic_match',
      profile_confidence: 'medium',
      profile_assignment_method: 'automatic',
      profile_model_key: 'RHEAVENDORS XS GRANDE E5 PRO',
      profile_display_name: 'Rheavendors XS Grande E5 Pro',
      profile_status: 'pending',
      reported_machine_interface: 'mdb',
      reported_machine_model: null,
      fault_count: 2,
      last_contact: '2026-09-25T08:00:00.000Z',
      connection_status: 'online',
    }],
    total: 1,
    fleet_total: 1,
    summary: {
      online: 1,
      delayed: 0,
      offline: 0,
      never: 0,
      unlinked: 0,
      active_faults: 1,
      profile_attention: 1,
    },
    branches: ['johannesburg'],
    limit: 75,
    offset: 0,
    generated_at: '2026-09-25T08:00:00.000Z',
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
        telemetry_region: 'south_africa',
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
    if (url.pathname === '/rest/v1/rpc/get_telemetry_machine_fleet') {
      await route.fulfill(jsonResponse(machineFleetFixture()));
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

async function openAuthenticatedPage(browser, pathname, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await installAuthenticatedTelemetryMock(page);
  await page.goto(`${baseURL}${pathname}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-platform-shell="telemetry-v3"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('[data-platform-navigation="desktop-v3"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#main-content')).toHaveCount(1, { timeout: 20_000 });
  return { context, page };
}

test('desktop telemetry shell exposes the current fleet navigation without retired mobile chrome', async ({ browser }) => {
  const { context, page } = await openAuthenticatedPage(browser, '/machines');
  const desktopNav = page.locator('[data-platform-navigation="desktop-v3"] nav[aria-label="Machine telemetry navigation"]');

  await expect(page.getByRole('heading', { name: 'Machines', level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(desktopNav.locator('a[href="/machines"][aria-current="page"]')).toHaveCount(1);

  for (const href of ['/', '/machines', '/alerts', '/telemetry', '/telemetry/test-center', '/map', '/products', '/telemetry/devices']) {
    await expect(desktopNav.locator(`a[href="${href}"]`)).toHaveCount(1);
  }

  await expect(page.locator('[data-mobile-shell="v1"]')).toBeHidden();
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
    const desktopNav = page.locator('[data-platform-navigation="desktop-v3"] nav[aria-label="Machine telemetry navigation"]');
    await expect(page).toHaveURL(`${baseURL}${pathname}`);
    await expect(desktopNav.locator(`a[href="${pathname}"][aria-current="page"]`)).toHaveCount(1);
    await expect(page.locator('[data-mobile-shell="v1"]')).toBeHidden();
    await expect(page.locator('.mobile-quick-bar, .mobile-nav-portal-root')).toHaveCount(0);
    await context.close();
  }
});

test('professional machine layout preserves readable scale and prevents character-level wrapping', async ({ browser }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1180, height: 820 }]) {
    const { context, page } = await openAuthenticatedPage(browser, '/machines', viewport);
    const machineBrowser = page.locator('[data-machine-browser="televend-v3"]');
    const statusCards = machineBrowser.locator('section[aria-label="Machine fleet status"] > button');
    const longMachineName = machineBrowser.locator('table tbody tr').first().locator('td').first().locator('strong');

    await expect(statusCards).toHaveCount(6);
    await expect(longMachineName).toBeVisible();

    const shellEvidence = await page.evaluate(() => {
      const rail = document.querySelector('[data-platform-navigation="desktop-v3"]');
      const main = document.querySelector('.application-main');
      const cards = Array.from(document.querySelectorAll('[data-machine-browser="televend-v3"] section[aria-label="Machine fleet status"] > button'));
      const longName = document.querySelector('[data-machine-browser="televend-v3"] table tbody tr td:first-child strong');
      const filters = document.querySelector('[data-machine-browser="televend-v3"] section[aria-label="Machine filters"]');
      const search = filters?.querySelector('input');
      if (!(rail instanceof HTMLElement) || !(main instanceof HTMLElement) || !(longName instanceof HTMLElement) || !(search instanceof HTMLElement)) return null;
      const cardLabel = cards[3]?.querySelector('span');
      return {
        railWidth: Number.parseFloat(getComputedStyle(rail).width),
        mainOverflowX: getComputedStyle(main).overflowX,
        statusGridColumns: getComputedStyle(cards[0]?.parentElement ?? document.body).gridTemplateColumns,
        cardLabelFontSize: cardLabel instanceof HTMLElement ? Number.parseFloat(getComputedStyle(cardLabel).fontSize) : 0,
        cardLabelWhiteSpace: cardLabel instanceof HTMLElement ? getComputedStyle(cardLabel).whiteSpace : '',
        longNameWordBreak: getComputedStyle(longName).wordBreak,
        longNameWhiteSpace: getComputedStyle(longName).whiteSpace,
        longNameLineHeight: Number.parseFloat(getComputedStyle(longName).lineHeight),
        searchHeight: Number.parseFloat(getComputedStyle(search).minHeight),
        searchFontSize: Number.parseFloat(getComputedStyle(search).fontSize),
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    expect(shellEvidence).not.toBeNull();
    expect(shellEvidence.railWidth).toBe(viewport.width === 1440 ? 256 : 236);
    expect(shellEvidence.mainOverflowX).toBe('clip');
    expect(shellEvidence.statusGridColumns.split(' ').filter(Boolean)).toHaveLength(3);
    expect(shellEvidence.cardLabelFontSize).toBeGreaterThanOrEqual(12);
    expect(shellEvidence.cardLabelWhiteSpace).toBe('nowrap');
    expect(shellEvidence.longNameWordBreak).not.toBe('break-all');
    expect(shellEvidence.longNameWhiteSpace).toBe('nowrap');
    expect(shellEvidence.longNameLineHeight).toBeGreaterThanOrEqual(18);
    expect(shellEvidence.searchHeight).toBeGreaterThanOrEqual(44);
    expect(shellEvidence.searchFontSize).toBeGreaterThanOrEqual(14);
    expect(shellEvidence.documentOverflow).toBe(false);

    await context.close();
  }
});

test('fleet overview uses a calmer three-column metric hierarchy on desktop', async ({ browser }) => {
  const { context, page } = await openAuthenticatedPage(browser, '/');
  const metrics = page.locator('[data-fleet-dashboard="televend-v3"] > section[aria-label="Fleet headline metrics"]');
  await expect(metrics.locator('> article')).toHaveCount(6, { timeout: 20_000 });

  const evidence = await metrics.evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
    gap: Number.parseFloat(getComputedStyle(element).gap),
    firstCardHeight: element.firstElementChild instanceof HTMLElement ? element.firstElementChild.getBoundingClientRect().height : 0,
    firstLabelFont: element.firstElementChild?.querySelector('span') instanceof HTMLElement
      ? Number.parseFloat(getComputedStyle(element.firstElementChild.querySelector('span')).fontSize)
      : 0,
  }));

  expect(evidence.columns).toBe(3);
  expect(evidence.gap).toBeGreaterThanOrEqual(12);
  expect(evidence.firstCardHeight).toBeGreaterThanOrEqual(110);
  expect(evidence.firstLabelFont).toBeGreaterThanOrEqual(12);

  await context.close();
});
