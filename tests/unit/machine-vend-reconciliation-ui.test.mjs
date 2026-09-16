import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const component = fs.readFileSync(
  new URL('../../components/telemetry-platform/MachineVendReconciliationPanel.tsx', import.meta.url),
  'utf8',
);
const page = fs.readFileSync(
  new URL('../../app/machines/[id]/page.tsx', import.meta.url),
  'utf8',
);

test('machine reconciliation is scoped to the selected active telemetry device', () => {
  assert.match(component, /from\('telemetry_devices'\)/);
  assert.match(component, /\.eq\('machine_id', machineId\)/);
  assert.match(component, /\.eq\('status', 'active'\)/);
  assert.match(component, /rpc\('get_telemetry_vend_reconciliation'/);
  assert.match(component, /p_device_id:\s*activeDevice\.id/);
  assert.doesNotMatch(component, /p_device_id:\s*null/);
});

test('reconciliation supports bounded operational windows rather than an unbounded fleet query', () => {
  assert.match(component, /type WindowDays = 7 \| 30 \| 90/);
  assert.match(component, /<option value=\{7\}>7 days<\/option>/);
  assert.match(component, /<option value=\{30\}>30 days<\/option>/);
  assert.match(component, /<option value=\{90\}>90 days<\/option>/);
  assert.match(component, /source\.slice\(0, 250\)/);
});

test('UI keeps cumulative counter snapshots authoritative and describes MDB/DEX as evidence', () => {
  assert.match(component, /Counter cups/);
  assert.match(component, /Production accounting/);
  assert.match(component, /MDB confirmed/);
  assert.match(component, /DEX audit units/);
  assert.match(component, /counter snapshots remain authoritative/i);
  assert.match(component, /MDB and DEX are corroborating evidence and never add another sale by themselves/i);
});

test('operator attention statuses are explicit while matched MDB and DEX rows are distinguished', () => {
  for (const status of [
    'evidence_conflict',
    'mdb_evidence_ahead',
    'dex_evidence_ahead',
    'counter_ahead',
    'evidence_only',
  ]) {
    assert.match(component, new RegExp(status));
  }
  assert.match(component, /matched_mdb_counter:\s*'MDB matched'/);
  assert.match(component, /matched_dex_counter:\s*'DEX matched'/);
});

test('machine detail route renders reconciliation beside the existing dashboard', () => {
  assert.match(page, /MachineVendReconciliationPanel/);
  assert.match(page, /<MachineDetail machineId=\{id\} \/>/);
  assert.match(page, /<MachineVendReconciliationPanel machineId=\{id\} \/>/);
});
