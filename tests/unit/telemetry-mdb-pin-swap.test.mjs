import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../supabase/migrations/20260909133549_telemetry_mdb_pin_swap_control.sql', import.meta.url), 'utf8');
const config = await readFile(new URL('../../supabase/functions/telemetry-config/index.ts', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../../components/telemetry-platform/TelemetryDevicesWorkspace.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../../app/telemetry/devices/page.tsx', import.meta.url), 'utf8');

test('MDB pin swap is a persisted device control and is sent by telemetry-config', () => {
  assert.match(migration, /mdb_pin_swap boolean not null default false/);
  assert.match(config, /mdb_master_polarity,mdb_slave_polarity,mdb_pin_swap/);
  assert.match(config, /swap_pins:\s*Boolean\(device\.mdb_pin_swap\)/);
});

test('device management exposes standard and swapped input-only MDB pin roles', () => {
  assert.match(page, /<TelemetryDevicesWorkspace \/>/);
  assert.match(workspace, /setPinSwap\(false\)/);
  assert.match(workspace, /setPinSwap\(true\)/);
  assert.match(workspace, /mdb_pin_swap: pinSwap/);
  assert.match(workspace, /GPIO4 and GPIO5 remain input-only/);
  assert.match(workspace, /GPIO5/);
  assert.match(workspace, /Master-TX/);
  assert.match(workspace, /Master-RX/);
});
