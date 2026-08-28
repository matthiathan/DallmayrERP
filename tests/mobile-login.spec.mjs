import { test, expect } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const responsiveQuery = '(max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse)';

async function rejectSupabaseRequests(page) {
  await page.route('https://egbiiizxsqlarqpnzxxs.supabase.co/**', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Expected test rejection' }),
    });
  });
}

for (const device of [
  { name: 'small portrait phone', viewport: { width: 320, height: 568 } },
  { name: 'modern portrait phone', viewport: { width: 390, height: 844 } },
  { name: 'landscape phone', viewport: { width: 844, height: 390 } },
  { name: 'portrait tablet', viewport: { width: 820, height: 1180 } },
  { name: 'landscape tablet', viewport: { width: 1180, height: 820 } },
  { name: 'large landscape touch tablet', viewport: { width: 1366, height: 1024 } },
]) {
  test(`${device.name}: responsive login remains scrollable and interactive`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: device.viewport,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    await rejectSupabaseRequests(page);
    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-responsive-surface', 'mobile-tablet');

    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    const remember = page.getByRole('checkbox', { name: /Remember me on this device/i });
    const submit = page.getByRole('button', { name: 'Sign in', exact: true });

    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(remember).toBeVisible();
    await expect(submit).toBeVisible();
    await expect(page.locator('.mobile-nav-portal-root')).toHaveCount(0);

    const state = await page.evaluate((query) => {
      const loginPage = document.querySelector('.login-page');
      const card = document.querySelector('.login-card');
      const submitButton = document.querySelector('.pulse-button');
      const emailInput = document.querySelector('input[type="email"]');
      const passwordInput = document.querySelector('input[type="password"]');
      const rememberLabel = document.querySelector('.login-remember-me');
      const tokenProbe = document.createElement('div');
      tokenProbe.style.cssText = 'position:absolute;left:-9999px;background:var(--ui-canvas);color:var(--ui-ink);border-color:var(--ui-surface);';
      document.body.appendChild(tokenProbe);
      const probeStyle = getComputedStyle(tokenProbe);
      const result = {
        queryMatches: window.matchMedia(query).matches,
        bodyOverflow: getComputedStyle(document.body).overflowY,
        htmlOverflow: getComputedStyle(document.documentElement).overflowY,
        inlineBodyOverflow: document.body.style.overflow,
        scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        loginBackground: loginPage ? getComputedStyle(loginPage).backgroundColor : '',
        cardBackground: card ? getComputedStyle(card).backgroundColor : '',
        desktopCanvasToken: probeStyle.backgroundColor,
        desktopSurfaceToken: probeStyle.borderTopColor,
        submitHeight: submitButton?.getBoundingClientRect().height ?? 0,
        emailHeight: emailInput?.getBoundingClientRect().height ?? 0,
        passwordHeight: passwordInput?.getBoundingClientRect().height ?? 0,
        rememberHeight: rememberLabel?.getBoundingClientRect().height ?? 0,
      };
      tokenProbe.remove();
      return result;
    }, responsiveQuery);

    expect(state.queryMatches).toBe(true);
    expect(state.bodyOverflow).not.toBe('hidden');
    expect(state.htmlOverflow).not.toBe('hidden');
    expect(state.inlineBodyOverflow).not.toBe('hidden');
    expect(state.loginBackground).toBe(state.desktopCanvasToken);
    expect(state.cardBackground).toBe(state.desktopSurfaceToken);
    expect(state.documentWidth).toBeLessThanOrEqual(state.viewportWidth + 1);
    expect(state.submitHeight).toBeGreaterThanOrEqual(44);
    expect(state.emailHeight).toBeGreaterThanOrEqual(44);
    expect(state.passwordHeight).toBeGreaterThanOrEqual(44);
    expect(state.rememberHeight).toBeGreaterThanOrEqual(44);

    if (state.scrollHeight > state.viewportHeight + 2) {
      await page.evaluate(() => window.scrollTo(0, Math.min(240, document.documentElement.scrollHeight)));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    await email.fill('mobile-test@example.com');
    await password.fill('not-a-real-password');
    await submit.click();
    await expect(page.locator('.login-card .error[role="alert"]')).toContainText(/Sign in failed|Expected test rejection|Authentication could not start/i);

    await context.close();
  });
}

test('login form has a complete keyboard path and visible focus indication', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false, isMobile: false });
  const page = await context.newPage();
  await rejectSupabaseRequests(page);
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });

  const email = page.getByLabel('Email', { exact: true });
  const password = page.getByLabel('Password', { exact: true });
  const remember = page.getByRole('checkbox', { name: /Remember me on this device/i });
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  const forgot = page.getByRole('button', { name: 'Forgot password', exact: true });
  const create = page.getByRole('button', { name: 'Create account', exact: true });

  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.keyboard.press('Tab');
  await expect(email).toBeFocused();
  const focusStyle = await email.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0);

  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(remember).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(forgot).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(create).toBeFocused();

  await context.close();
});

test('1366px fine-pointer desktop does not enter responsive mode', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, hasTouch: false, isMobile: false });
  const page = await context.newPage();
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  const matches = await page.evaluate((query) => window.matchMedia(query).matches, responsiveQuery);
  expect(matches).toBe(false);
  await expect(page.locator('html')).not.toHaveAttribute('data-responsive-surface', 'mobile-tablet');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1367);
  await context.close();
});
