import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../supabase/migrations/20260909133549_telemetry_mdb_pin_swap_control.sql', import.meta.url), 'utf8');
const config = await readFile(new URL('../../supabase/functions/telemetry-config/index.ts', import.meta.url), 'utf8');
const control = await readFile(new URL('../../components/features/MdbPinOrderControl.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../../app/telemetry/devices/page.tsx', import.meta.url), 'utf8');

test('MDB pin swap is a persisted device control and is sent by telemetry-config', () => {
  assert.match(migration, /mdb_pin_swap boolean not null default false/);
  assert.match(config, /mdb_master_polarity,mdb_slave_polarity,mdb_pin_swap/);
  assert.match(config, /swap_pins:\s*Boolean\(device\.mdb_pin_swap\)/);
});

test('device management exposes standard and swapped input-only MDB pin roles', () => {
  assert.match(page, /<MdbPinOrderControl \/>/);
  assert.match(control, /Standard · GPIO4 Master-TX \/ GPIO5 Master-RX/);
  assert.match(control, /Swapped · GPIO5 Master-TX \/ GPIO4 Master-RX/);
  assert.match(control, /\.update\(\{ mdb_pin_swap: nextSwap/);
  assert.match(control, /GPIO4 and GPIO5 remain input-only/);
});
