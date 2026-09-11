import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = await readFile(new URL('../../components/telemetry-platform/TelemetryDevicesWorkspace.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../../app/telemetry/devices/page.tsx', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../supabase/migrations/20260909133549_telemetry_mdb_pin_swap_control.sql', import.meta.url), 'utf8');
const config = await readFile(new URL('../../supabase/functions/telemetry-config/index.ts', import.meta.url), 'utf8');

test('telemetry devices route uses the finished device workspace directly', () => {
  assert.match(page, /TelemetryDevicesWorkspace/);
  assert.doesNotMatch(page, /AdminTelemetryDevices/);
  assert.doesNotMatch(page, /MdbPinOrderControl/);
  assert.match(workspace, /data-telemetry-devices="v3"/);
});

test('MDB pin order is connected from database through device UI and config API', () => {
  assert.match(migration, /mdb_pin_swap boolean not null default false/);
  assert.match(workspace, /mdb_pin_swap/);
  assert.match(workspace, /setPinSwap\(Boolean\(selected\.mdb_pin_swap\)\)/);
  assert.match(workspace, /mdb_pin_swap: pinSwap/);
  assert.match(workspace, /Standard/);
  assert.match(workspace, /Swapped/);
  assert.match(workspace, /GPIO4 and GPIO5 remain input-only/);
  assert.match(config, /swap_pins: Boolean\(device\.mdb_pin_swap\)/);
});

test('finished device workspace retains fleet operations and safety controls', () => {
  assert.match(workspace, /save_telemetry_device_configuration/);
  assert.match(workspace, /p_mdb_pin_swap: pinSwap/);
  assert.match(workspace, /p_location_interval_minutes: locationInterval/);
  assert.match(workspace, /p_warning_megabytes: warningMb/);
  assert.match(workspace, /request_telemetry_prepaid_balance/);
  assert.match(workspace, /delete_telemetry_device/);
  assert.match(workspace, /TelemetryEnrollmentWindowControl/);
  assert.match(workspace, /SignalStrengthIndicator/);
  assert.match(workspace, /At least one transport must remain enabled/);
});
