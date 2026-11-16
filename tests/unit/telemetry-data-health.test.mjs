import assert from 'node:assert/strict';
import test from 'node:test';
import { machineCommunicationState, salesReportState } from '../../lib/telemetry/data-health.ts';
const NOW = Date.UTC(2026, 10, 6, 10);
const assignment = { machineId: 'machine-b', assignmentId: 'assignment-b' };

test('machine communication cannot be inferred from uploads or sales inactivity', () => {
  assert.equal(machineCommunicationState(assignment, null, NOW).key, 'unknown');
});

test('machine evidence uses observation time and never crosses an assignment boundary', () => {
  const evidence = { ...assignment, observedAt: new Date(NOW - 10 * 60_000).toISOString(), expectedIntervalMinutes: 5, periodicEvidenceReliable: true };
  assert.equal(machineCommunicationState(assignment, evidence, NOW).key, 'current');
  assert.equal(machineCommunicationState(assignment, evidence, NOW + 1).key, 'stale');
  assert.equal(machineCommunicationState(assignment, { ...evidence, assignmentId: 'old-assignment' }, NOW).key, 'unknown');
  assert.equal(machineCommunicationState(assignment, { ...evidence, machineId: 'machine-a' }, NOW).key, 'unknown');
  assert.equal(machineCommunicationState({ ...assignment, assignmentId: null }, evidence, NOW).key, 'unknown');
  assert.equal(machineCommunicationState(assignment, { ...evidence, periodicEvidenceReliable: false }, NOW).key, 'unknown');
});

test('daily report grace boundary is independent of device contact and old report receipts', () => {
  const evidence = { ...assignment, expectedPeriod: '2026-11-05', receivedPeriods: ['2026-11-04'], dueAt: '2026-11-06T00:15:00+02:00', graceMinutes: 60 };
  const graceEnd = Date.parse('2026-11-06T01:15:00+02:00');
  assert.equal(salesReportState(assignment, evidence, graceEnd).key, 'current');
  assert.equal(salesReportState(assignment, evidence, graceEnd + 1).key, 'overdue');
  assert.equal(salesReportState(assignment, { ...evidence, receivedPeriods: ['2026-11-05'] }, NOW).key, 'current');
  assert.equal(salesReportState(assignment, { ...evidence, assignmentId: 'old-assignment' }, NOW).key, 'unknown');
  assert.equal(salesReportState(assignment, null, NOW).key, 'unknown');
});

test('interval report receives its own 20 percent grace period', () => {
  const evidence = { ...assignment, expectedPeriod: 'interval-1', receivedPeriods: [], dueAt: new Date(NOW).toISOString(), graceMinutes: 2 };
  assert.equal(salesReportState(assignment, evidence, NOW + 2 * 60_000).key, 'current');
  assert.equal(salesReportState(assignment, evidence, NOW + 2 * 60_000 + 1).key, 'overdue');
});
