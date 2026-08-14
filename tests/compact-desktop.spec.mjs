import { expect, test } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseOrigin = 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const authUserId = '10000000-0000-4000-8000-000000000091';
const businessUserId = '20000000-0000-4000-8000-000000000091';

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
    email: 'layout-test@example.com',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 7200,
  })).toString('base64url');
  const accessToken = `${header}.${payload}.test-signature`;

  return {
    access_token: accessToken,
    refresh_token: 'layout-test-refresh-token',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    user: {
      id: authUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'layout-test@example.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

async function installAuthenticatedShellMock(page) {
  const session = makeSession();

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
        id: 'details-layout-test',
        user_id: businessUserId,
        first_name: 'Layout',
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

async function waitForStableShell(page, requestedRoute) {
  const deadline = Date.now() + 20_000;
  let previousUrl = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    try {
      const currentUrl = page.url();
      const shellReady = await page.locator('.application-shell-v2').count() === 1
        && await page.locator('.dallmayr-sidebar').count() === 1
        && await page.locator('.application-header-inner').count() === 1
        && await page.getByRole('main').count() === 1;

      if (shellReady && currentUrl === previousUrl) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= 500) return;
      } else {
        previousUrl = currentUrl;
        stableSince = shellReady ? Date.now() : 0;
      }
    } catch {
      previousUrl = '';
      stableSince = 0;
    }

    await page.waitForTimeout(100);
  }

  throw new Error(`${requestedRoute} did not settle on the authenticated application shell.`);
}

async function readShellMetrics(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(() => {
        const sidebar = document.querySelector('.dallmayr-sidebar');
        const shell = document.querySelector('.application-shell-v2');
        const header = document.querySelector('.application-header-inner');
        const pageContext = document.querySelector('.application-page-context');
        const search = document.querySelector('.application-header-search');
        const actions = document.querySelector('.application-header-actions');
        const collapseButton = document.querySelector('.dallmayr-sidebar-brand > button');
        const sidebarRect = sidebar?.getBoundingClientRect();
        const headerRect = header?.getBoundingClientRect();
        const pageContextRect = pageContext?.getBoundingClientRect();
        const searchRect = search?.getBoundingClientRect();
        const actionsRect = actions?.getBoundingClientRect();

        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          sidebarWidth: sidebarRect?.width ?? 0,
          shellPaddingLeft: shell ? Number.parseFloat(getComputedStyle(shell).paddingLeft) : 0,
          headerLeft: headerRect?.left ?? 0,
          headerRight: headerRect?.right ?? 0,
          pageContextWidth: pageContextRect?.width ?? 0,
          pageContextRight: pageContextRect?.right ?? 0,
          searchWidth: searchRect?.width ?? 0,
          searchLeft: searchRect?.left ?? 0,
          searchRight: searchRect?.right ?? 0,
          actionsWidth: actionsRect?.width ?? 0,
          actionsLeft: actionsRect?.left ?? 0,
          collapseButtonDisplay: collapseButton ? getComputedStyle(collapseButton).display : '',
          responsiveSurface: document.documentElement.getAttribute('data-responsive-surface'),
        };
      });
    } catch (error) {
      if (!(error instanceof Error) || !/execution context was destroyed|navigation/i.test(error.message) || attempt === 2) throw error;
      await waitForStableShell(page, 'metric retry');
    }
  }

  throw new Error('Could not read compact desktop shell metrics.');
}

test('fine-pointer laptop widths use compact desktop navigation without horizontal overflow', async ({ browser }) => {
  for (const width of [901, 1024, 1279]) {
    const context = await browser.newContext({
      viewport: { width, height: 820 },
      hasTouch: false,
      isMobile: false,
    });
    const page = await context.newPage();
    await installAuthenticatedShellMock(page);
    await page.goto(`${baseURL}/operations/service-jobs`, { waitUntil: 'domcontentloaded' });
    await waitForStableShell(page, `/operations/service-jobs at ${width}px`);

    const metrics = await readShellMetrics(page);
    expect(metrics.responsiveSurface).not.toBe('mobile-tablet');
    expect(metrics.sidebarWidth).toBeGreaterThanOrEqual(87);
    expect(metrics.sidebarWidth).toBeLessThanOrEqual(89);
    expect(metrics.shellPaddingLeft).toBeGreaterThanOrEqual(87);
    expect(metrics.shellPaddingLeft).toBeLessThanOrEqual(89);
    expect(metrics.collapseButtonDisplay).toBe('none');
    expect(metrics.headerLeft).toBeGreaterThanOrEqual(87);
    expect(metrics.headerRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.pageContextWidth).toBeGreaterThanOrEqual(100);
    expect(metrics.searchWidth).toBeGreaterThanOrEqual(140);
    expect(metrics.actionsWidth).toBeGreaterThan(0);
    expect(metrics.pageContextRight).toBeLessThanOrEqual(metrics.searchLeft + 1);
    expect(metrics.searchRight).toBeLessThanOrEqual(metrics.actionsLeft + 1);

    await context.close();
  }
});

test('1280px fine-pointer desktop restores the canonical standard navigation rail', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();
  await installAuthenticatedShellMock(page);
  await page.goto(`${baseURL}/operations/service-jobs`, { waitUntil: 'domcontentloaded' });
  await waitForStableShell(page, '/operations/service-jobs at 1280px');

  const metrics = await readShellMetrics(page);
  expect(metrics.responsiveSurface).not.toBe('mobile-tablet');
  expect(metrics.sidebarWidth).toBeGreaterThanOrEqual(263);
  expect(metrics.sidebarWidth).toBeLessThanOrEqual(265);
  expect(metrics.shellPaddingLeft).toBeGreaterThanOrEqual(263);
  expect(metrics.shellPaddingLeft).toBeLessThanOrEqual(265);
  expect(metrics.collapseButtonDisplay).not.toBe('none');
  expect(metrics.headerRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);

  await context.close();
});
