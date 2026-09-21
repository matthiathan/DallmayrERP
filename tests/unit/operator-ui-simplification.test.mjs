import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const devicesPath = new URL('../../components/telemetry-platform/TelemetryDevicesWorkspace.tsx', import.meta.url);
const alertsPath = new URL('../../components/telemetry-platform/AlarmCenter.tsx', import.meta.url);
const fleetPath = new URL('../../components/telemetry-platform/TelevendFleetDashboard.tsx', import.meta.url);
const analyticsPath = new URL('../../components/telemetry-platform/TelemetryAnalytics.tsx', import.meta.url);
const reportsPath = new URL('../../components/telemetry-platform/TelemetryReports.tsx', import.meta.url);
const mapPath = new URL('../../components/features/TelemetryLocationMap.tsx', import.meta.url);
const navigationPath = new URL('../../components/layout/appShellNavigation.ts', import.meta.url);

test('device management separates configuration into task-focused tabs', async () => {
  const source = await readFile(devicesPath, 'utf8');

  assert.match(source, /type DeviceWorkspaceTab = 'overview' \| 'assignment' \| 'connectivity' \| 'mdb' \| 'location' \| 'sim' \| 'advanced'/);
  assert.match(source, /aria-label="Device settings sections"/);
  for (const label of ['Overview', 'Assignment', 'Connectivity', 'MDB', 'Location', 'SIM & Data', 'Advanced']) {
    assert.match(source, new RegExp(`>${label}<`));
  }
  assert.match(source, /data-device-tab="overview"/);
  assert.match(source, /data-device-tab="advanced"/);
});

test('operator-facing alert terminology is consistent', async () => {
  const alerts = await readFile(alertsPath, 'utf8');
  const fleet = await readFile(fleetPath, 'utf8');

  assert.match(alerts, /<h1>Alerts<\/h1>/);
  assert.doesNotMatch(alerts, /Alarms & events/);
  assert.doesNotMatch(fleet, />Alarms</);
  assert.match(fleet, />Alerts</);
});

test('analytics and reports explain distinct jobs', async () => {
  const analytics = await readFile(analyticsPath, 'utf8');
  const reports = await readFile(reportsPath, 'utf8');
  const navigation = await readFile(navigationPath, 'utf8');

  assert.match(analytics, /Explore and compare/);
  assert.match(reports, /structured operational tables and exports/i);
  assert.match(navigation, /Explore trends, comparisons and performance signals/);
  assert.match(navigation, /Structured operational tables, audit views and exports/);
});

test('map and fleet copy no longer use ERP terminology', async () => {
  const map = await readFile(mapPath, 'utf8');
  const fleet = await readFile(fleetPath, 'utf8');

  assert.match(map, /Assigned site location/);
  assert.doesNotMatch(map, /ERP site fallback/);
  assert.doesNotMatch(fleet, /DallmayrERP/);
});
