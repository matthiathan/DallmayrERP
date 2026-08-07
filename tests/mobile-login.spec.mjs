import { test, expect } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const responsiveQuery = '(max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse)';

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

    await page.route('https://egbiiizxsqlarqpnzxxs.supabase.co/**', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Expected test rejection' }),
      });
    });

    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-responsive-surface', 'mobile-tablet');

    const email = page.locator('input[type="email"]');
    const password = page.locator('input[type="password"]');
    const submit = page.getByRole('button', { name: 'Sign in' });

    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(submit).toBeVisible();
    await expect(page.locator('.mobile-nav-portal-root')).toHaveCount(0);

    const state = await page.evaluate((query) => {
      const card = document.querySelector('.login-card');
      return {
        queryMatches: window.matchMedia(query).matches,
        bodyOverflow: getComputedStyle(document.body).overflowY,
        htmlOverflow: getComputedStyle(document.documentElement).overflowY,
        inlineBodyOverflow: document.body.style.overflow,
        scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
        viewportHeight: window.innerHeight,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        cardBackground: card ? getComputedStyle(card).backgroundColor : '',
      };
    }, responsiveQuery);

    expect(state.queryMatches).toBe(true);
    expect(state.bodyOverflow).not.toBe('hidden');
    expect(state.htmlOverflow).not.toBe('hidden');
    expect(state.inlineBodyOverflow).not.toBe('hidden');
    expect(state.bodyBackground).toBe('rgb(245, 240, 230)');
    expect(state.cardBackground).toBe('rgb(255, 255, 255)');

    if (state.scrollHeight > state.viewportHeight + 2) {
      await page.evaluate(() => window.scrollTo(0, Math.min(240, document.documentElement.scrollHeight)));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    await email.fill('mobile-test@example.com');
    await password.fill('not-a-real-password');
    await submit.click();
    await expect(page.getByText(/Login failed|Expected test rejection|Login could not start/i)).toBeVisible();

    await context.close();
  });
}

test('1366px fine-pointer desktop does not enter responsive mode', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, hasTouch: false, isMobile: false });
  const page = await context.newPage();
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  const matches = await page.evaluate((query) => window.matchMedia(query).matches, responsiveQuery);
  expect(matches).toBe(false);
  await expect(page.locator('html')).not.toHaveAttribute('data-responsive-surface', 'mobile-tablet');
  await context.close();
});
