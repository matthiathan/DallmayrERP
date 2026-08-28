import { expect, test } from '@playwright/test';
import { installSupabaseAuthFixture } from './helpers/supabase-auth-fixture.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseOrigin = 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const authUserId = '10000000-0000-4000-8000-000000000092';
const businessUserId = '20000000-0000-4000-8000-000000000092';
const serviceJobId = '30000000-0000-4000-8000-000000000092';

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
    email: 'dialog-test@example.com',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 7200,
  })).toString('base64url');
  const accessToken = `${header}.${payload}.test-signature`;

  return {
    access_token: accessToken,
    refresh_token: 'dialog-test-refresh-token',
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    user: {
      id: authUserId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'dialog-test@example.com',
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
        id: 'details-dialog-test',
        user_id: businessUserId,
        first_name: 'Dialog',
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
    if (url.pathname === '/rest/v1/service_jobs') {
      const select = url.searchParams.get('select');
      const idFilter = url.searchParams.get('id');
      const limit = url.searchParams.get('limit');
      if (select === 'job_number' && idFilter === `eq.${serviceJobId}` && limit === '1') {
        await route.fulfill(jsonResponse([{
          job_number: 'SJ-2048',
        }]));
        return;
      }
      await route.fulfill(jsonResponse([]));
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
  await expect(page.getByRole('button', { name: 'Quick access' })).toBeVisible({ timeout: 20_000 });
}

test('Quick Access traps focus, isolates the background, closes on Escape and restores focus', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();
  await installAuthenticatedShellMock(page);
  await page.goto(`${baseURL}/operations/service-jobs`, { waitUntil: 'domcontentloaded' });
  await waitForStableShell(page);

  const accessibleTrigger = page.getByRole('button', { name: 'Quick access' });
  const trigger = page.locator('button[aria-controls="quick-access-dialog"]');
  await expect(accessibleTrigger).toBeVisible();
  await trigger.focus();
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Quick access' });
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(accessibleTrigger).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();

  const isolated = await page.evaluate(() => {
    const portal = document.querySelector('[data-dallmayr-dialog-portal="true"]');
    const background = Array.from(document.body.children).filter((element) => (
      element instanceof HTMLElement
      && element !== portal
      && element.tagName !== 'SCRIPT'
    ));
    return {
      portalPresent: Boolean(portal),
      allInert: background.length > 0 && background.every((element) => element.inert),
      allHidden: background.length > 0 && background.every((element) => element.getAttribute('aria-hidden') === 'true'),
      overflow: document.body.style.overflow,
    };
  });
  expect(isolated.portalPresent).toBe(true);
  expect(isolated.allInert).toBe(true);
  expect(isolated.allHidden).toBe(true);
  expect(isolated.overflow).toBe('hidden');

  const focusable = dialog.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  const focusableCount = await focusable.count();
  expect(focusableCount).toBeGreaterThan(1);

  await focusable.first().focus();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await focusable.nth(focusableCount - 1).focus();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(accessibleTrigger).toBeVisible();
  await expect(accessibleTrigger).toBeFocused();

  const restored = await page.evaluate(() => ({
    portalCount: document.querySelectorAll('[data-dallmayr-dialog-portal="true"]').length,
    overflow: document.body.style.overflow,
  }));
  expect(restored.portalCount).toBe(0);
  expect(restored.overflow).toBe('');

  await context.close();
});

test('Quick Access recent history shows a business job number instead of the selected record UUID', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    hasTouch: false,
    isMobile: false,
  });
  const page = await context.newPage();
  await installAuthenticatedShellMock(page);
  await page.goto(`${baseURL}/operations/service-jobs?job=${serviceJobId}`, { waitUntil: 'domcontentloaded' });
  await waitForStableShell(page);

  await page.getByRole('button', { name: 'Quick access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick access' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('SJ-2048');
  await expect(dialog).not.toContainText(serviceJobId);

  await context.close();
});
