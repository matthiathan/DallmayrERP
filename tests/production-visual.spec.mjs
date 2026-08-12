import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const baseURL = (process.env.PRODUCTION_BASE_URL ?? 'https://dallmayrerp.onrender.com').replace(/\/$/, '');
const email = process.env.PRODUCTION_VISUAL_EMAIL ?? '';
const password = process.env.PRODUCTION_VISUAL_PASSWORD ?? '';
const routeList = (process.env.PRODUCTION_VISUAL_ROUTES ?? '/,/customers,/operations/dashboard,/operations/assets,/warehouse/stock,/work,/messages,/workspace')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const artifactRoot = process.env.PRODUCTION_VISUAL_ARTIFACT_DIR ?? 'artifacts/production-visual/current';

const devices = [
  { name: 'desktop-1440', viewport: { width: 1440, height: 1000 }, hasTouch: false, isMobile: false },
  { name: 'tablet-820', viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
  { name: 'mobile-390', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];

function safeRouteName(route) {
  if (route === '/') return 'home';
  return route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'route';
}

async function login(page) {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 });
  await expect(page.locator('.login-card .error[role="alert"]')).toHaveCount(0);
}

async function stabilize(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.waitForTimeout(500);
}

for (const device of devices) {
  test(`${device.name}: authenticated production routes remain visually stable`, async ({ browser }) => {
    test.skip(!email || !password, 'Production visual credentials are required.');

    const context = await browser.newContext({
      viewport: device.viewport,
      hasTouch: device.hasTouch,
      isMobile: device.isMobile,
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();
    await login(page);

    const deviceDir = path.join(artifactRoot, device.name);
    fs.mkdirSync(deviceDir, { recursive: true });
    const routeEvidence = [];

    for (const route of routeList) {
      await page.goto(`${baseURL}${route}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(800);
      await stabilize(page);

      const current = new URL(page.url());
      expect(current.pathname, `${route} redirected to login`).not.toMatch(/^\/login(?:\/|$)/);
      await expect(page.getByRole('main')).toHaveCount(1);

      const metrics = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        responsiveSurface: document.documentElement.getAttribute('data-responsive-surface'),
        title: document.title,
      }));

      expect(metrics.documentWidth, `${route} has horizontal overflow`).toBeLessThanOrEqual(metrics.viewportWidth + 1);

      const screenshotName = `${safeRouteName(route)}.png`;
      await page.screenshot({
        path: path.join(deviceDir, screenshotName),
        fullPage: true,
        animations: 'disabled',
      });

      routeEvidence.push({
        requestedRoute: route,
        finalPath: current.pathname,
        screenshot: screenshotName,
        ...metrics,
      });
    }

    fs.writeFileSync(
      path.join(deviceDir, 'manifest.json'),
      `${JSON.stringify({ device, baseURL, routes: routeEvidence }, null, 2)}\n`,
      'utf8',
    );

    await context.close();
  });
}
