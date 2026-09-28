import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('machine detail route exposes the field acceptance workflow', async () => {
  const page = await read('app/machines/[id]/page.tsx');
  assert.match(page, /MachineFieldAcceptancePanel/);
  assert.match(page, /<MachineFieldAcceptancePanel machineId=\{id\}/);
});

test('machine field acceptance panel reuses authoritative readiness and audit records', async () => {
  const panel = await read('components/telemetry-platform/MachineFieldAcceptancePanel.tsx');
  assert.match(panel, /get_telemetry_field_acceptance_readiness/);
  assert.match(panel, /telemetry_field_acceptance_records/);
  assert.match(panel, /telemetry_test_sessions/);
  assert.match(panel, /Current preflight/);
  assert.match(panel, /Latest acceptance/);
});

test('machine field acceptance panel carries the controlled vend plan into Test Center', async () => {
  const panel = await read('components/telemetry-platform/MachineFieldAcceptancePanel.tsx');
  assert.match(panel, /3 × Instant Porridge/);
  assert.match(panel, /1 × Caramel Cappuccino/);
  assert.match(panel, /1 × another mapped product/);
  assert.match(panel, /free, failed or cancelled/i);
  assert.match(panel, /telemetry\/test-center\?device=/);
});

test('machine field acceptance panel is read-only and does not finalize acceptance', async () => {
  const panel = await read('components/telemetry-platform/MachineFieldAcceptancePanel.tsx');
  assert.doesNotMatch(panel, /finalize_telemetry_field_acceptance/);
  assert.match(panel, /account_scope/);
  assert.match(panel, /client/);
  assert.match(panel, /read-only/i);
});
