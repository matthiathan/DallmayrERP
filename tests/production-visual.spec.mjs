import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const baseURL = (process.env.PRODUCTION_BASE_URL ?? 'https://dallmayrerp.onrender.com').replace(/\/$/, '');
const email = process.env.PRODUCTION_VISUAL_EMAIL ?? '';
const password = process.env.PRODUCTION_VISUAL_PASSWORD ?? '';
const routeList = (process.env.PRODUCTION_VISUAL_ROUTES ?? '/,/machines,/alerts,/telemetry,/telemetry/reports,/telemetry/test-center,/map,/products,/telemetry/devices,/users')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const artifactRoot = process.env.PRODUCTION_VISUAL_ARTIFACT_DIR ?? 'artifacts/production-visual/current';

const devices = [
  { name: 'desktop-1440', viewport: { width: 1440, height: 1000 }, hasTouch: false, isMobile: false },
  { name: 'laptop-1180', viewport: { width: 1180, height: 820 }, hasTouch: false, isMobile: false },
  { name: 'tablet-820', viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
  { name: 'mobile-390', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];

function safeRouteName(route) {
  if (route === '/') return 'home';
  return route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'route';
}

function normalisePathname(value) {
  if (value === '/') return value;
  return value.replace(/\/+$/, '') || '/';
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

async function login(page, screenshotPath) {
  await page.goto(`${baseURL}/login`, { waitUntil: 'load', timeout: 45_000 });
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await waitForLoginHydration(page);
  await stabilize(page);

  const loginUrl = new URL(page.url());
  expect(normalisePathname(loginUrl.pathname), 'Login did not resolve to /login').toBe('/login');
  const loginMetrics = await readMetrics(page, '/login');
  expect(loginMetrics.documentWidth, '/login has horizontal overflow').toBeLessThanOrEqual(loginMetrics.viewportWidth + 1);

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 });
  await waitForStableAuthenticatedPage(page, 'post-login redirect');
  await expect(page.locator('.login-card .error[role="alert"]')).toHaveCount(0);

  return {
    requestedRoute: '/login',
    finalPath: loginUrl.pathname,
    screenshot: path.basename(screenshotPath),
    ...loginMetrics,
  };
}

async function captureRouteEvidence(page, route, deviceDir, screenshotName = `${safeRouteName(route)}.png`) {
  await openAuthenticatedRoute(page, route);
  await stabilize(page);
  await waitForStableAuthenticatedPage(page, `${route} after stabilization`);

  const current = new URL(page.url());
  expect(current.pathname, `${route} redirected to login`).not.toMatch(/^\/login(?:\/|$)/);
  expect(normalisePathname(current.pathname), `${route} did not resolve to the requested route`).toBe(normalisePathname(route));
  await expect(page.getByRole('main')).toHaveCount(1);

  const metrics = await readMetrics(page, route);
  expect(metrics.documentWidth, `${route} has horizontal overflow`).toBeLessThanOrEqual(metrics.viewportWidth + 1);

  await page.screenshot({
    path: path.join(deviceDir, screenshotName),
    fullPage: true,
    animations: 'disabled',
  });

  return {
    requestedRoute: route,
    finalPath: current.pathname,
    screenshot: screenshotName,
    ...metrics,
  };
}

async function discoverMachineDetailRoute(page) {
  await openAuthenticatedRoute(page, '/machines');
  await page.waitForFunction(() => (
    Array.from(document.querySelectorAll('a[href^="/machines/"]')).some((anchor) => {
      const href = anchor.getAttribute('href') ?? '';
      return /^\/machines\/[^/?#]+(?:[?#].*)?$/.test(href);
    })
  ), null, { timeout: 30_000 });

  const href = await page.evaluate(() => {
    const anchor = Array.from(document.querySelectorAll('a[href^="/machines/"]')).find((candidate) => {
      const value = candidate.getAttribute('href') ?? '';
      return /^\/machines\/[^/?#]+(?:[?#].*)?$/.test(value);
    });
    return anchor?.getAttribute('href') ?? null;
  });

  if (!href) throw new Error('Machines did not expose a machine-detail link for production visual QA.');
  return new URL(href, baseURL).pathname;
}

for (const device of devices) {
  test(`${device.name}: authenticated production routes remain visually stable`, async ({ browser }) => {
    test.setTimeout(300_000);
    test.skip(!email || !password, 'Production visual credentials are required.');

    const context = await browser.newContext({
      viewport: device.viewport,
      hasTouch: device.hasTouch,
      isMobile: device.isMobile,
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();
    const deviceDir = path.join(artifactRoot, device.name);
    fs.mkdirSync(deviceDir, { recursive: true });

    const loginEvidence = await login(page, path.join(deviceDir, 'login.png'));

    const routeEvidence = [];
    for (const route of routeList) {
      routeEvidence.push(await captureRouteEvidence(page, route, deviceDir));
    }

    const machineDetailRoute = await discoverMachineDetailRoute(page);
    routeEvidence.push(await captureRouteEvidence(page, machineDetailRoute, deviceDir, 'machine-detail.png'));

    fs.writeFileSync(
      path.join(deviceDir, 'manifest.json'),
      `${JSON.stringify({ device, baseURL, login: loginEvidence, routes: routeEvidence }, null, 2)}\n`,
      'utf8',
    );

    await context.close();
  });
}
