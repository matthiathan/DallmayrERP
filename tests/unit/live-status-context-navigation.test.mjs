import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('operational telemetry pages share one live-data freshness indicator', async () => {
  const [indicator, fleet, alerts, devices, map] = await Promise.all([
    read('components/ui/LiveDataStatus.tsx'),
    read('app/page.tsx'),
    read('app/alerts/page.tsx'),
    read('app/telemetry/devices/page.tsx'),
    read('app/map/page.tsx'),
  ]);

  assert.match(indicator, /Refreshing/);
  assert.match(indicator, /Stale/);
  assert.match(indicator, /Updated/);
  assert.match(indicator, /data-live-data-state/);
  for (const source of [fleet, alerts, devices, map]) {
    assert.match(source, /LiveDataStatus/);
  }
});

test('Map no longer exposes the retired location-control UI and routes configuration to Device Management', async () => {
  const [page, workspace, styles] = await Promise.all([
    read('app/map/page.tsx'),
    read('components/features/TelemetryLocationWorkspace.tsx'),
    read('components/features/TelemetryLocationWorkspace.module.css'),
  ]);
  assert.match(page, /TelemetryLocationWorkspace/);
  assert.match(workspace, /data-location-control-owner="device-management"/);
  assert.match(workspace, /href="\/telemetry\/devices"/);
  assert.match(workspace, /Manage device location settings/);
  assert.match(styles, /telemetry-location-controls/);
  assert.match(styles, /display: none/);
});

test('Device Management provides direct Machine and Test Center workflow navigation', async () => {
  const [page, actions] = await Promise.all([
    read('app/telemetry/devices/page.tsx'),
    read('components/features/TelemetryDeviceContextLinks.tsx'),
  ]);
  assert.match(page, /TelemetryDeviceContextLinks/);
  assert.match(actions, /Open machines/);
  assert.match(actions, /Open Test Center/);
  assert.match(actions, /\/telemetry\/test-center\?device=/);
});
