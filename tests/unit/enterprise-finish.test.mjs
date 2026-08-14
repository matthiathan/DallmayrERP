import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_EXECUTIVE_KPIS,
  enterpriseShortcutsForRole,
  mergeRecentHistory,
  nextReportRun,
  normaliseExecutiveKpis,
  shortcutHrefForEvent,
} from '../../lib/productivity/enterpriseFinish.ts';

test('recent history de-duplicates exact records and keeps newest first', () => {
  const first = { href: '/customers/1', label: 'Customer · 1', visitedAt: '2026-08-14T08:00:00.000Z' };
  const second = { href: '/work/2', label: 'Work · 2', visitedAt: '2026-08-14T08:01:00.000Z' };
  const revisit = { ...first, visitedAt: '2026-08-14T08:02:00.000Z' };
  const history = mergeRecentHistory(mergeRecentHistory([first], second), revisit);
  assert.deepEqual(history.map((item) => item.href), ['/customers/1', '/work/2']);
  assert.equal(history[0].visitedAt, revisit.visitedAt);
});

test('report schedules calculate the next weekly and monthly due dates', () => {
  const now = new Date(2026, 7, 14, 11, 0, 0);
  const weekly = nextReportRun({
    id: 'weekly', reportKey: 'executive-management-pack', name: 'Weekly', cadence: 'weekly', weekday: 1,
    dayOfMonth: 1, hour: 8, minute: 0, format: 'pdf', enabled: true, createdAt: now.toISOString(),
  }, now);
  assert.equal(weekly?.getDay(), 1);
  assert.equal(weekly?.getDate(), 17);
  assert.equal(weekly?.getHours(), 8);

  const monthly = nextReportRun({
    id: 'monthly', reportKey: 'executive-management-pack', name: 'Monthly', cadence: 'monthly', weekday: 1,
    dayOfMonth: 1, hour: 8, minute: 0, format: 'pdf', enabled: true, createdAt: now.toISOString(),
  }, now);
  assert.equal(monthly?.getMonth(), 8);
  assert.equal(monthly?.getDate(), 1);
});

test('executive KPI selection accepts only catalog keys and keeps a safe default', () => {
  assert.deepEqual(normaliseExecutiveKpis(['customers', 'assets', 'bad-key']), ['customers', 'assets']);
  assert.deepEqual(normaliseExecutiveKpis([]), DEFAULT_EXECUTIVE_KPIS);
  assert.equal(normaliseExecutiveKpis(['customers', 'customers']).length, 1);
});

test('enterprise shortcuts are role-aware and do not hijack ordinary typing', () => {
  assert.equal(enterpriseShortcutsForRole('executive').some((shortcut) => shortcut.href === '/executive/reports'), true);
  assert.equal(enterpriseShortcutsForRole('warehouse_staff').some((shortcut) => shortcut.href === '/executive/reports'), false);
  assert.equal(shortcutHrefForEvent('operations', { key: 's', altKey: true, shiftKey: true }), '/operations/service-jobs');
  assert.equal(shortcutHrefForEvent('sales', { key: 's', altKey: true, shiftKey: true }), null);
  assert.equal(shortcutHrefForEvent('operations', { key: 'w', altKey: false, shiftKey: true }), null);
});
