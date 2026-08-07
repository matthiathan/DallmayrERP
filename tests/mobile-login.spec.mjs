import { test, expect } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

for (const device of [
  { name: 'small portrait phone', viewport: { width: 320, height: 568 } },
  { name: 'modern portrait phone', viewport: { width: 390, height: 844 } },
  { name: 'landscape phone', viewport: { width: 844, height: 390 } },
]) {
  test(`${device.name}: login remains scrollable and interactive`, async ({ browser }) => {
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

    const email = page.locator('input[type="email"]');
    const password = page.locator('input[type="password"]');
    const submit = page.getByRole('button', { name: 'Sign in' });

    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(submit).toBeVisible();
    await expect(page.locator('.mobile-nav-portal-root')).toHaveCount(0);

    const scrollState = await page.evaluate(() => ({
      bodyOverflow: getComputedStyle(document.body).overflowY,
      htmlOverflow: getComputedStyle(document.documentElement).overflowY,
      inlineBodyOverflow: document.body.style.overflow,
      scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
      viewportHeight: window.innerHeight,
    }));

    expect(scrollState.bodyOverflow).not.toBe('hidden');
    expect(scrollState.htmlOverflow).not.toBe('hidden');
    expect(scrollState.inlineBodyOverflow).not.toBe('hidden');

    if (scrollState.scrollHeight > scrollState.viewportHeight + 2) {
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
