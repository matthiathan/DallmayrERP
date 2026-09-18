import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('components/features/AdminTelemetryDevices.tsx', 'utf8');

test('device management saves through the atomic region-aware configuration RPC', () => {
  assert.match(source, /rpc\(['"]save_telemetry_device_configuration['"]/,
    'AdminTelemetryDevices must save through save_telemetry_device_configuration');

  for (const retiredRpc of [
    'set_telemetry_device_control',
    'set_telemetry_device_location_control',
    'set_telemetry_prepaid_balance_control',
  ]) {
    assert.doesNotMatch(source, new RegExp(`rpc\\(['"]${retiredRpc}['"]`),
      `AdminTelemetryDevices must not call retired RPC ${retiredRpc}`);
  }
});
