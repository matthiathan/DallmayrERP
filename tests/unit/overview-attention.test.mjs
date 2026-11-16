import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOverviewAttention } from '../../lib/telemetry/overview-attention.ts';

const machines = [
  { id: 'm1', customer_id: 'c1', site_id: 's1', machine_type: 'Coffee', machine_name: 'Reception coffee' },
  { id: 'm2', customer_id: 'c2', site_id: 's2', machine_type: 'Snack', machine_name: 'Workshop snack' },
];
const item = (id, machineId, kind, title) => ({ id, machineId, kind, title, deviceId: id, deviceCode: id, evidenceState: ['communication', 'reporting'].includes(kind) ? 'unknown' : undefined, priority: 3, severity: 'warning', occurredAt: null });
const items = [
  item('offline', 'm1', 'offline', 'Device connectivity: Offline'),
  item('communication', 'm1', 'communication', 'Machine communication: Unknown'),
  item('report', 'm1', 'reporting', 'Sales report: Unknown'),
  item('delayed', 'm2', 'delayed', 'Device connectivity: Delayed'),
  item('unassigned', null, 'never_seen', 'Device connectivity: Never seen'),
];

test('unknown evidence is separated from actionable issues without hiding it', () => {
  const result = selectOverviewAttention(items, machines, {});
  assert.deepEqual(result.actionable.map(({ id }) => id), ['offline', 'delayed']);
  assert.deepEqual(result.verification.map(({ id }) => id), ['communication', 'report', 'unassigned']);
  assert.equal(result.machineCount, 2);
  assert.equal(result.unassignedDeviceCount, 1);
});

test('customer, site, machine type and attention filters intersect across the full queue', () => {
  const result = selectOverviewAttention(items, machines, { customerId: 'c1', siteId: 's1', machineType: 'Coffee', category: 'verification' });
  assert.deepEqual(result.verification.map(({ id }) => id), ['communication', 'report']);
  assert.equal(result.actionable.length, 0);
  assert.equal(result.machineCount, 1);
  assert.equal(result.unassignedDeviceCount, 0);
  assert.equal(selectOverviewAttention(items, machines, { customerId: 'missing' }).machineCount, 0);
});

test('verified stale evidence stays actionable and does not depend on display wording', () => {
  const result = selectOverviewAttention([
    { ...item('stale', 'm1', 'communication', 'Communication needs checking'), evidenceState: 'stale' },
    { ...item('unknown', 'm1', 'reporting', 'Report coverage unavailable'), evidenceState: 'unknown' },
  ], machines, {});
  assert.deepEqual(result.actionable.map(({ id }) => id), ['stale']);
  assert.deepEqual(result.verification.map(({ id }) => id), ['unknown']);
});

test('machines without active devices remain visible as unverified, alongside older open faults', async () => {
  const { buildOverviewAttention } = await import('../../lib/telemetry/overview-attention.ts');
  const result = buildOverviewAttention([], [], machines, [
    { id: 'old', device_id: 'removed', machine_id: 'm1', fault_code: 'WATER', normalization_status: 'verified_rule', severity: 'critical', started_at: '2025-01-01T00:00:00Z' },
  ], Date.UTC(2026, 10, 16));
  assert.equal(result.filter(({ kind }) => kind === 'fault').length, 1);
  const selected = selectOverviewAttention(result, machines, {});
  assert.equal(selected.actionable[0].machineId, 'm1');
  assert.equal(selected.verification.length, 2);
  assert.equal(selected.machineCount, 2);
  assert.equal(selected.unassignedDeviceCount, 0);
});

test('missing machine type is explicitly filterable without guessing from names', () => {
  const result = selectOverviewAttention([item('unknown-type', 'm3', 'offline', 'Offline')], [{ id: 'm3', customer_id: null, site_id: null, machine_type: null, machine_name: 'Coffee machine' }], { machineType: '__not_reported__' });
  assert.equal(result.machineCount, 1);
  assert.equal(selectOverviewAttention(result.actionable, machines, { machineType: 'Coffee' }).machineCount, 0);
});

test('raw codes and platform diagnostics never masquerade as verified machine faults', async () => {
  const { buildOverviewAttention } = await import('../../lib/telemetry/overview-attention.ts');
  const fault = { device_id: 'd', machine_id: 'm1', fault_code: 'CODE', severity: 'critical', started_at: '2026-01-01T00:00:00Z' };
  const items = buildOverviewAttention([], [], [], [
    { ...fault, id: 'verified', normalization_status: 'verified_rule' },
    { ...fault, id: 'raw', normalization_status: 'raw' },
    { ...fault, id: 'diagnostic', normalization_status: 'telemetry_diagnostic' },
  ], Date.UTC(2026, 10, 16));
  assert.deepEqual(items.map(({ kind }) => kind), ['fault', 'raw_fault', 'diagnostic']);
  const result = selectOverviewAttention(items, [], {});
  assert.deepEqual(result.verification.map(({ id }) => id), ['fault:raw']);
  assert.equal(items.find(({ kind }) => kind === 'diagnostic').title, 'Telemetry diagnostic: CODE');
});
