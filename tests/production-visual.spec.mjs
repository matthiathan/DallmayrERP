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

function isExpectedNavigationAbort(error) {
  return error instanceof Error && /net::ERR_ABORTED|NS_BINDING_ABORTED|navigation.*interrupted/i.test(error.message);
}

async function waitForStableAuthenticatedPage(page, requestedRoute) {
  const deadline = Date.now() + 45_000;
  let previousUrl = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    const currentUrl = page.url();
    let currentPath = '';
    try {
      currentPath = new URL(currentUrl).pathname;
    } catch {
      // A transient navigation can briefly expose an incomplete location.
    }

    let mainCount = 0;
    let documentReady = false;
    if (currentPath && !/^\/login(?:\/|$)/.test(currentPath)) {
      try {
        mainCount = await page.getByRole('main').count();
        documentReady = await page.evaluate(() => document.readyState === 'complete');
      } catch {
        mainCount = 0;
        documentReady = false;
      }
    }

    if (currentPath && !/^\/login(?:\/|$)/.test(currentPath) && mainCount === 1 && documentReady) {
      if (currentUrl === previousUrl) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= 750) return;
      } else {
        previousUrl = currentUrl;
        stableSince = Date.now();
      }
    } else {
      previousUrl = currentUrl;
      stableSince = 0;
    }

    await page.waitForTimeout(200);
  }

  throw new Error(`${requestedRoute} did not settle on one authenticated main landmark within 45 seconds. Final URL: ${page.url()}`);
}

async function openAuthenticatedRoute(page, route) {
  try {
    await page.goto(`${baseURL}${route}`, { waitUntil: 'commit', timeout: 45_000 });
  } catch (error) {
    if (!isExpectedNavigationAbort(error)) throw error;
  }

  await waitForStableAuthenticatedPage(page, route);
}

async function waitForLoginHydration(page) {
  const activateToggle = page.getByRole('button', { name: 'First login? Activate account', exact: true });
  await expect(activateToggle).toBeVisible({ timeout: 45_000 });
  await activateToggle.click();
  await expect(page.getByRole('heading', { name: 'Activate your Dallmayr Telemetry account', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I already have an account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
}

async function login(page) {
  await page.goto(`${baseURL}/login`, { waitUntil: 'load', timeout: 45_000 });
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await waitForLoginHydration(page);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 });
  await waitForStableAuthenticatedPage(page, 'post-login redirect');
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

async function readMetrics(page, route) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        responsiveSurface: document.documentElement.getAttribute('data-responsive-surface'),
        title: document.title,
      }));
    } catch (error) {
      if (!(error instanceof Error) || !/execution context was destroyed|navigation/i.test(error.message) || attempt === 2) {
        throw error;
      }
      await waitForStableAuthenticatedPage(page, `${route} metric retry`);
    }
  }

  throw new Error(`Could not read layout metrics for ${route}.`);
}

for (const device of devices) {
  test(`${device.name}: authenticated production routes remain visually stable`, async ({ browser }) => {
    test.setTimeout(180_000);
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
      await openAuthenticatedRoute(page, route);
      await stabilize(page);
      await waitForStableAuthenticatedPage(page, `${route} after stabilization`);

      const current = new URL(page.url());
      expect(current.pathname, `${route} redirected to login`).not.toMatch(/^\/login(?:\/|$)/);
      await expect(page.getByRole('main')).toHaveCount(1);

      const metrics = await readMetrics(page, route);
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
