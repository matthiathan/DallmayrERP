import assert from 'node:assert/strict';
import test from 'node:test';

import { canAccessPath, getDefaultPathForRole } from '../../lib/auth/permissions.ts';
import { addLocalDays, formatLocalDate, localDateAfterDays } from '../../lib/dates/local-date.ts';
import {
  connectedRecordHref,
  getConnectedRecordRequest,
  isTerminalConnectedStatus,
  pathnameFromConnectedHref,
} from '../../lib/navigation/connectedWorkflows.ts';
import {
  containsMachineTerm,
  isExactMachineMatch,
  machineSearchLabel,
  normaliseLookupTerm,
  rankMachineMatches,
} from '../../lib/search/machineSearch.ts';
import {
  canTransitionDelivery,
  canTransitionServiceJob,
  getDeliveryNextStatuses,
  getServiceJobNextStatuses,
} from '../../lib/workflows/statusTransitions.ts';
import {
  addDays,
  getMyWorkAttentionItems,
  getMyWorkCalendar,
  getMyWorkDashboardCounts,
  groupMyWorkItems,
  localDateKey,
  priorityRank,
  startOfLocalDay,
  startOfWeek,
  urgencyKey,
} from '../../components/features/mondayMyWorkSelectors.ts';
import { displayDetailsName, displayProfileName, isProfileComplete } from '../../types/dallmayrerp.ts';

function workItem(overrides = {}) {
  return {
    id: 'work:1',
    source: 'work',
    sourceLabel: 'Work',
    title: 'Example',
    subtitle: 'WK-1',
    description: 'Example work',
    status: 'new',
    priority: 'medium',
    branch: 'jhb',
    dueAt: null,
    href: '/work/1',
    isOpen: true,
    isMine: false,
    isUnassigned: false,
    approvalPending: false,
    ...overrides,
  };
}

test('permissions keep public auth routes open and protect role-specific workspaces', () => {
  assert.equal(canAccessPath('sales', '/login'), true);
  assert.equal(canAccessPath('warehouse_staff', '/onboarding'), true);
  assert.equal(canAccessPath('admin', '/admin/activity'), true);
  assert.equal(canAccessPath('operations', '/operations/service-jobs'), true);
  assert.equal(canAccessPath('sales', '/operations/service-jobs'), false);
  assert.equal(canAccessPath('finance', '/warehouse/purchasing/approvals'), true);
  assert.equal(canAccessPath('finance', '/warehouse/stock'), false);
  assert.equal(canAccessPath('executive', '/executive/command-centre'), true);
  assert.equal(canAccessPath('executive', '/'), false);
  assert.equal(getDefaultPathForRole('road_technician'), '/workspace');
});

test('connected workflow routing resolves record pages and query-driven operational records', () => {
  assert.deepEqual(getConnectedRecordRequest('/customers/customer 1'), { kind: 'customer', id: 'customer 1' });
  assert.deepEqual(getConnectedRecordRequest('/operations/assets/machine%2F1'), { kind: 'machine', id: 'machine/1' });
  assert.deepEqual(getConnectedRecordRequest('/work/work-1'), { kind: 'work', id: 'work-1' });
  assert.deepEqual(getConnectedRecordRequest('/warehouse/stock/stock-1'), { kind: 'stock', id: 'stock-1' });
  assert.deepEqual(getConnectedRecordRequest('/operations/service-jobs', 'view=kanban&job=service-1'), { kind: 'service', id: 'service-1' });
  assert.deepEqual(getConnectedRecordRequest('/operations/deliveries', '?order=delivery-1'), { kind: 'delivery', id: 'delivery-1' });
  assert.equal(getConnectedRecordRequest('/operations/assets/lifecycle'), null);
  assert.equal(getConnectedRecordRequest('/operations/service-jobs', 'view=kanban'), null);
});

test('connected workflow hrefs preserve stable entity routes and terminal-state semantics', () => {
  assert.equal(connectedRecordHref('customer', 'customer 1'), '/customers/customer%201');
  assert.equal(connectedRecordHref('machine', 'machine/1'), '/operations/assets/machine%2F1');
  assert.equal(connectedRecordHref('service', 'service 1'), '/operations/service-jobs?job=service%201');
  assert.equal(connectedRecordHref('delivery', 'delivery 1'), '/operations/deliveries?order=delivery%201');
  assert.equal(pathnameFromConnectedHref('/operations/service-jobs?job=service-1'), '/operations/service-jobs');
  assert.equal(isTerminalConnectedStatus('closed'), true);
  assert.equal(isTerminalConnectedStatus('delivered'), true);
  assert.equal(isTerminalConnectedStatus('in_progress'), false);
});

test('local date helpers preserve local calendar dates and handle boundaries', () => {
  const lateLocalTime = new Date(2026, 0, 5, 23, 55, 0);
  assert.equal(formatLocalDate(lateLocalTime), '2026-01-05');
  assert.equal(formatLocalDate(addLocalDays(new Date(2026, 0, 31, 12), 1)), '2026-02-01');
  assert.equal(localDateAfterDays(-1, new Date(2026, 2, 1, 9)), '2026-02-28');
});

test('business profile helpers require every onboarding field and prefer a real display name', () => {
  const complete = {
    first_name: 'Ada',
    last_name: 'Lovelace',
    phone_number: '0110000000',
    birthday: '1990-01-01',
    emergency_contact_name: 'Grace',
    emergency_contact_phone: '0820000000',
  };
  assert.equal(isProfileComplete(complete), true);
  assert.equal(isProfileComplete({ ...complete, phone_number: '   ' }), false);
  assert.equal(displayDetailsName(complete, 'fallback@example.com'), 'Ada Lovelace');
  assert.equal(displayDetailsName(null, 'fallback@example.com'), 'fallback@example.com');
  assert.equal(displayProfileName(null), 'Unknown user');
});

test('machine search normalizes Unicode noise and punctuation', () => {
  assert.equal(normaliseLookupTerm('  ABC\u200B(123),   X  '), 'ABC 123 X');
  const machine = {
    id: 'machine-1',
    machine_barcode: 'VM-001',
    serial_number: 'SN-900',
    machine_name: 'Lobby Coffee 2',
    model: 'X 200',
  };
  assert.equal(containsMachineTerm(machine, 'coffee 2'), true);
  assert.equal(isExactMachineMatch(machine, ' vm-001 '), true);
  assert.equal(isExactMachineMatch(machine, 'coffee 2'), false);
  assert.equal(machineSearchLabel(machine), 'Lobby Coffee 2');
});

test('machine search ranks exact identifiers before partial matches', () => {
  const machines = [
    { id: 'a', machine_barcode: 'VM-1000', serial_number: 'SER-20', machine_name: 'Alpha 10' },
    { id: 'b', machine_barcode: 'VM-10', serial_number: 'SER-30', machine_name: 'Beta 2' },
    { id: 'c', machine_barcode: 'X-10', serial_number: 'SER-40', machine_name: 'Gamma VM-10' },
  ];
  assert.deepEqual(rankMachineMatches(machines, 'VM-10').map((machine) => machine.id), ['b', 'a', 'c']);
});

test('service job transition contract blocks skipping verification and terminal reopening', () => {
  assert.deepEqual(getServiceJobNextStatuses('new'), ['new', 'assigned', 'cancelled']);
  assert.equal(canTransitionServiceJob('assigned', 'in_progress'), true);
  assert.equal(canTransitionServiceJob('assigned', 'completed'), false);
  assert.equal(canTransitionServiceJob('completed', 'closed'), false);
  assert.equal(canTransitionServiceJob('completed', 'verified'), true);
  assert.equal(canTransitionServiceJob('verified', 'closed'), true);
  assert.deepEqual(getServiceJobNextStatuses('closed'), ['closed']);
  assert.equal(canTransitionServiceJob('cancelled', 'new'), false);
});

test('delivery transition contract preserves ordered progression and terminal states', () => {
  assert.deepEqual(getDeliveryNextStatuses('draft'), ['draft', 'picked', 'cancelled']);
  assert.equal(canTransitionDelivery('picked', 'dispatched'), true);
  assert.equal(canTransitionDelivery('picked', 'delivered'), false);
  assert.equal(canTransitionDelivery('dispatched', 'delivered'), true);
  assert.equal(canTransitionDelivery('delivered', 'closed'), true);
  assert.equal(canTransitionDelivery('closed', 'draft'), false);
  assert.deepEqual(getDeliveryNextStatuses('cancelled'), ['cancelled']);
});

test('My Work date selectors use Monday-based weeks and stable local keys', () => {
  const friday = new Date(2026, 7, 14, 15, 30, 0);
  assert.equal(formatLocalDate(startOfLocalDay(friday)), '2026-08-14');
  assert.equal(formatLocalDate(startOfWeek(friday)), '2026-08-10');
  assert.equal(formatLocalDate(addDays(friday, 3)), '2026-08-17');
  assert.equal(localDateKey('not-a-date'), null);
});

test('My Work grouping, counts and attention ranking reflect operational priority', () => {
  const today = startOfLocalDay();
  const yesterday = addDays(today, -1).toISOString();
  const tomorrow = addDays(today, 1).toISOString();
  const later = addDays(today, 10).toISOString();
  const items = [
    workItem({ id: 'critical', priority: 'critical', dueAt: yesterday, isMine: true }),
    workItem({ id: 'approval', priority: 'high', approvalPending: true, dueAt: tomorrow }),
    workItem({ id: 'unassigned', priority: 'low', isUnassigned: true, dueAt: later }),
    workItem({ id: 'closed', status: 'closed', isOpen: false, isMine: true, dueAt: tomorrow }),
  ];

  assert.equal(urgencyKey(items[0]), 'Attention');
  assert.equal(urgencyKey(items[1]), 'Attention');
  assert.equal(urgencyKey(items[2]), 'Later');
  assert.equal(priorityRank('critical'), 0);
  assert.deepEqual(groupMyWorkItems(items, 'urgency').map(([key]) => key), ['Attention', 'This week', 'Later']);
  assert.deepEqual(getMyWorkDashboardCounts(items), {
    mine: 1,
    overdue: 1,
    approvals: 1,
    unassigned: 1,
    nextSeven: 1,
  });
  assert.deepEqual(getMyWorkAttentionItems(items).map((item) => item.id), ['critical', 'approval', 'unassigned']);
});

test('My Work calendar includes only items inside the requested seven-day window', () => {
  const monday = startOfWeek(new Date(2026, 7, 14, 12));
  const items = [
    workItem({ id: 'mon', dueAt: addDays(monday, 0).toISOString() }),
    workItem({ id: 'sun', dueAt: addDays(monday, 6).toISOString() }),
    workItem({ id: 'next-mon', dueAt: addDays(monday, 7).toISOString() }),
    workItem({ id: 'none', dueAt: null }),
  ];
  const calendar = getMyWorkCalendar(items, monday);
  assert.equal(calendar.calendarDays.length, 7);
  assert.deepEqual(calendar.calendarItems.map((item) => item.id), ['mon', 'sun']);
});
