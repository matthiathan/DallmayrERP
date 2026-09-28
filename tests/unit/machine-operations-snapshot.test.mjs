import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('machine detail route includes operational telemetry snapshot', async () => {
  const page = await read('app/machines/[id]/page.tsx');
  assert.match(page, /MachineOperationsSnapshot/);
  assert.match(page, /machineId=\{id\}/);
});

test('machine operations snapshot exposes transport, usage, reporting and config state', async () => {
  const panel = await read('components/telemetry-platform/MachineOperationsSnapshot.tsx');
  assert.match(panel, /get_telemetry_transport_usage/);
  assert.match(panel, /Wi-Fi usage/);
  assert.match(panel, /Cellular usage/);
  assert.match(panel, /Total usage/);
  assert.match(panel, /Reporting mode/);
  assert.match(panel, /Configuration/);
  assert.match(panel, /Decoder profile/);
  assert.match(panel, /SignalStrengthIndicator/);
});

test('machine operations snapshot keeps operational deep links available', async () => {
  const panel = await read('components/telemetry-platform/MachineOperationsSnapshot.tsx');
  assert.match(panel, /telemetry\/test-center\?device=/);
  assert.match(panel, /\/telemetry\/devices/);
  assert.match(panel, /\/products/);
});
