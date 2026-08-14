import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DesktopNavigationRail } from '../../components/layout/DesktopNavigationRail.tsx';
import {
  favoriteHrefForLocation,
  favoritePathname,
  MAX_FAVORITES,
  parseFavoriteEntries,
  toggleFavoriteEntry,
} from '../../lib/navigation/favorites.ts';

test('favorite storage migrates legacy href arrays, de-duplicates entries and enforces one shared eight-item limit', () => {
  const legacy = JSON.stringify([
    '/work',
    '/operations/service-jobs?job=service-1',
    '/work',
    '/customers/customer-1',
    '/operations/assets/machine-1',
    '/warehouse/stock/stock-1',
    '/operations/deliveries?order=delivery-1',
    '/executive/reports',
    '/operations/dispatch',
    '/operations/exceptions',
  ]);
  const entries = parseFavoriteEntries(legacy);

  assert.equal(entries.length, MAX_FAVORITES);
  assert.deepEqual(entries[0], { href: '/work', label: 'Work' });
  assert.equal(entries[1].href, '/operations/service-jobs?job=service-1');
  assert.equal(entries[1].label, 'Service Jobs');
  assert.equal(entries.filter((entry) => entry.href === '/work').length, 1);
});

test('favorite href helpers preserve selected-record queries while access checks can use the route pathname', () => {
  const href = favoriteHrefForLocation('/operations/service-jobs', 'view=kanban&job=service-1');
  assert.equal(href, '/operations/service-jobs?view=kanban&job=service-1');
  assert.equal(favoritePathname(href), '/operations/service-jobs');
});

test('module and record-level favorites can coexist and the ninth pin is rejected without dropping existing pins', () => {
  let entries = [{ href: '/operations/service-jobs', label: 'Scheduled Call Log' }];
  entries = toggleFavoriteEntry(entries, {
    href: '/operations/service-jobs?job=service-1',
    label: 'Scheduled Call Log · service-1',
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[1].href, '/operations/service-jobs?job=service-1');

  while (entries.length < MAX_FAVORITES) {
    const index = entries.length;
    entries = toggleFavoriteEntry(entries, { href: `/work/${index}`, label: `Work ${index}` });
  }
  const full = entries;
  const rejected = toggleFavoriteEntry(full, { href: '/customers/customer-99', label: 'Customer 99' });
  assert.deepEqual(rejected, full);

  const removed = toggleFavoriteEntry(full, full[1]);
  assert.equal(removed.some((entry) => entry.href === '/operations/service-jobs?job=service-1'), false);
});

test('desktop navigation renders pinned record URLs instead of discarding non-catalog favorites', () => {
  const markup = renderToStaticMarkup(createElement(DesktopNavigationRail, {
    collapsed: false,
    homePath: '/workspace',
    onToggleCollapse: () => {},
    pathname: '/operations/service-jobs',
    pinnedItems: [{ href: '/operations/service-jobs?job=service-1', label: 'Scheduled Call Log · service-1' }],
    roleLabel: 'Operations Manager',
    sections: [],
  }));

  assert.match(markup, /Pinned/);
  assert.match(markup, /Scheduled Call Log · service-1/);
  assert.match(markup, /href="\/operations\/service-jobs\?job=service-1"/);
});
