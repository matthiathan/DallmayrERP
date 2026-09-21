import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('operational telemetry pages share one live-data freshness indicator', async () => {
  const [indicator, fleet, alerts, devices, map] = await Promise.all([
    read('components/ui/LiveDataStatus.tsx'),
    read('components/telemetry-platform/TelevendFleetDashboard.tsx'),
    read('components/telemetry-platform/AlarmCenter.tsx'),
    read('components/telemetry-platform/TelemetryDevicesWorkspace.tsx'),
    read('components/features/TelemetryLocationMap.tsx'),
  ]);

  assert.match(indicator, /Refreshing/);
  assert.match(indicator, /Stale/);
  assert.match(indicator, /Updated/);
  assert.match(indicator, /data-live-data-state/);
  for (const source of [fleet, alerts, devices, map]) {
    assert.match(source, /LiveDataStatus/);
  }
});

test('Map no longer calls the retired location-control RPC and routes configuration to Device Management', async () => {
  const map = await read('components/features/TelemetryLocationMap.tsx');
  assert.doesNotMatch(map, /set_telemetry_device_location_control/);
  assert.match(map, /\/telemetry\/devices\?device=/);
  assert.match(map, /Manage device/);
});

test('Device Management provides direct Machine and Test Center navigation for the selected controller', async () => {
  const devices = await read('components/telemetry-platform/TelemetryDevicesWorkspace.tsx');
  assert.match(devices, /from 'next\/link'/);
  assert.match(devices, /Open machine/);
  assert.match(devices, /Open Test Center/);
  assert.match(devices, /\/telemetry\/test-center\?device=/);
});
