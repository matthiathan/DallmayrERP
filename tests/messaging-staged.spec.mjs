import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const requiredEnv = [
  'STAGED_USER_A_EMAIL',
  'STAGED_USER_A_PASSWORD',
  'STAGED_USER_B_EMAIL',
  'STAGED_USER_B_PASSWORD',
];

for (const name of requiredEnv) {
  if (!process.env[name]) throw new Error(`Missing required staged messaging environment variable: ${name}`);
}

const userA = {
  email: process.env.STAGED_USER_A_EMAIL,
  password: process.env.STAGED_USER_A_PASSWORD,
};
const userB = {
  email: process.env.STAGED_USER_B_EMAIL,
  password: process.env.STAGED_USER_B_PASSWORD,
};

async function signIn(page, credentials) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 20000 });
}

async function openMessages(page) {
  await page.goto('/work/messages');
  await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel('Search company directory')).toBeVisible();
}

async function selectDirectRecipient(page, email) {
  const search = page.getByLabel('Search company directory');
  await search.fill(email);
  const option = page.getByRole('option').filter({ hasText: email }).first();
  await expect(option).toBeVisible({ timeout: 15000 });
  await option.click();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible({ timeout: 15000 });
}

async function assertNoHorizontalOverflow(page) {
  const result = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }));
  expect(result.documentWidth).toBeLessThanOrEqual(result.documentClientWidth + 1);
  expect(result.bodyWidth).toBeLessThanOrEqual(result.bodyClientWidth + 1);
}

test.describe.configure({ mode: 'serial' });

test('two authenticated users exchange a committed message through the messaging UI', async ({ browser }) => {
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await Promise.all([signIn(pageA, userA), signIn(pageB, userB)]);
    await Promise.all([openMessages(pageA), openMessages(pageB)]);

    await selectDirectRecipient(pageA, userB.email);
    await pageB.reload();
    await expect(pageB.getByLabel('Message', { exact: true })).toBeVisible({ timeout: 15000 });

    const marker = `browser-stage-${randomUUID()}`;
    await pageA.getByLabel('Message', { exact: true }).fill(marker);
    await pageA.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(pageA.getByText(marker, { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(pageB.getByText(marker, { exact: true })).toBeVisible({ timeout: 20000 });
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()]);
  }
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'tablet', width: 820, height: 1180, isMobile: true, hasTouch: true },
]) {
  test(`${viewport.name} messaging workspace remains usable without horizontal overflow`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
    });
    const page = await context.newPage();

    try {
      await signIn(page, userA);
      await openMessages(page);
      await assertNoHorizontalOverflow(page);
      await expect(page.getByLabel('Search company directory')).toBeVisible();
      await expect(page.locator('.messages-v2-thread-list')).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
