import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const baseURL = (process.env.PRODUCTION_BASE_URL ?? 'https://dallmayrerp.onrender.com').replace(/\/$/, '');
const artifactRoot = process.env.PRODUCTION_ROLE_UI_ARTIFACT_DIR ?? 'artifacts/production-role-ui';

const devices = [
  { name: 'desktop-1440', viewport: { width: 1440, height: 1000 }, hasTouch: false, isMobile: false },
  { name: 'tablet-820', viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
  { name: 'mobile-390', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];

function parseRoleMatrix() {
  const raw = process.env.PRODUCTION_ROLE_MATRIX_JSON ?? '';
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PRODUCTION_ROLE_MATRIX_JSON must be valid JSON.');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('PRODUCTION_ROLE_MATRIX_JSON must contain at least one role profile.');
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Role profile ${index + 1} must be an object.`);
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const email = typeof entry.email === 'string' ? entry.email.trim() : '';
    const password = typeof entry.password === 'string' ? entry.password : '';
    const roleLabel = typeof entry.roleLabel === 'string' ? entry.roleLabel.trim() : '';
    const routes = Array.isArray(entry.routes)
      ? entry.routes.filter((route) => typeof route === 'string' && route.startsWith('/'))
      : [];

    if (!name || !email || !password || routes.length === 0) {
      throw new Error(`Role profile ${index + 1} requires name, email, password and at least one absolute route.`);
    }

    return { name, email, password, roleLabel, routes };
  });
}

const roleProfiles = parseRoleMatrix();

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
}

function safeRouteName(route) {
  if (route === '/') return 'home';
  return route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'route';
}

function isExpectedNavigationAbort(error) {
  return error instanceof Error && /net::ERR_ABORTED|NS_BINDING_ABORTED|navigation.*interrupted/i.test(error.message);
}

async function waitForStableAuthenticatedPage(page) {
  const deadline = Date.now() + 45_000;
  let previousUrl = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    const currentUrl = page.url();
    let currentPath = '';
    try {
      currentPath = new URL(currentUrl).pathname;
    } catch {
      currentPath = '';
    }

    let mainCount = 0;
    let ready = false;
    if (currentPath && !/^\/login(?:\/|$)/.test(currentPath)) {
      try {
        mainCount = await page.getByRole('main').count();
        ready = await page.evaluate(() => document.readyState === 'complete');
      } catch {
        mainCount = 0;
      }
    }

    if (currentPath && !/^\/login(?:\/|$)/.test(currentPath) && mainCount === 1 && ready) {
      if (currentUrl === previousUrl) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 800) return;
      } else {
        previousUrl = currentUrl;
        stableSince = Date.now();
      }
    } else {
      previousUrl = currentUrl;
      stableSince = 0;
    }

    await page.waitForTimeout(150);
  }

  throw new Error(`Authenticated page did not settle. Final URL: ${page.url()}`);
}

async function signIn(page, profile) {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByLabel('Email', { exact: true }).fill(profile.email);
  await page.getByLabel('Password', { exact: true }).fill(profile.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await waitForStableAuthenticatedPage(page);
  expect(new URL(page.url()).pathname).not.toMatch(/^\/login(?:\/|$)/);
}

async function openProtectedRoute(page, route) {
  try {
    await page.goto(`${baseURL}${route}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (error) {
    if (!isExpectedNavigationAbort(error)) throw error;
  }
  await waitForStableAuthenticatedPage(page);
}

async function assertLayout(page, requestedRoute, profile) {
  const currentPath = new URL(page.url()).pathname;
  expect(currentPath, `${profile.name} was redirected to login from ${requestedRoute}`).not.toMatch(/^\/login(?:\/|$)/);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.locator('.access-denied')).toHaveCount(0);

  if (profile.roleLabel) {
    await expect(page.locator('.application-status-strip, .application-page-context').filter({ hasText: profile.roleLabel }).first()).toBeVisible();
  }

  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));

  expect(metrics.documentWidth, `${profile.name} ${requestedRoute} document overflow`).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.bodyWidth, `${profile.name} ${requestedRoute} body overflow`).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

test.skip(roleProfiles.length === 0, 'PRODUCTION_ROLE_MATRIX_JSON is required for authenticated role-matrix UI validation.');

for (const profile of roleProfiles) {
  for (const device of devices) {
    test(`${profile.name} · ${device.name} · authorized routes remain usable`, async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext({
        viewport: device.viewport,
        hasTouch: device.hasTouch,
        isMobile: device.isMobile,
      });
      const page = await context.newPage();
      await signIn(page, profile);

      const profileDir = path.join(artifactRoot, safeName(profile.name), device.name);
      fs.mkdirSync(profileDir, { recursive: true });
      const manifest = [];

      for (const route of profile.routes) {
        await openProtectedRoute(page, route);
        await assertLayout(page, route, profile);
        const screenshot = path.join(profileDir, `${safeRouteName(route)}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        manifest.push({ requestedRoute: route, finalPath: new URL(page.url()).pathname, screenshot });
      }

      fs.writeFileSync(path.join(profileDir, 'manifest.json'), JSON.stringify({
        profile: profile.name,
        roleLabel: profile.roleLabel || null,
        device: device.name,
        routes: manifest,
      }, null, 2));

      await context.close();
    });
  }
}
