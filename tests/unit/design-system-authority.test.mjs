import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('AppShell owns the rebuilt telemetry platform shell presentation', async () => {
  const source = await read('components/layout/AppShell.tsx');
  assert.match(source, /TelemetryPlatformShell\.module\.css/);
  assert.match(source, /data-platform-shell="telemetry-v3"/);
  assert.match(source, /<DesktopNavigationRail/);
  assert.match(source, /<MobileTelemetryShell/);
  assert.match(source, /<strong>\{activeTitle\}<\/strong>/);
});

test('core telemetry routes render the rebuilt platform owners directly', async () => {
  const routeContracts = [
    ['app/page.tsx', 'TelevendFleetDashboard'],
    ['app/machines/page.tsx', 'MachineFleetBrowser'],
    ['app/machines/[id]/page.tsx', 'MachineDetail'],
    ['app/alerts/page.tsx', 'AlarmCenter'],
    ['app/telemetry/page.tsx', 'TelemetryAnalytics'],
  ];

  for (const [routePath, owner] of routeContracts) {
    const source = await read(routePath);
    assert.match(source, new RegExp(`\\b${owner}\\b`), `${routePath} must render ${owner}`);
    for (const retired of ['MachineTelemetryOverview', 'TelemetryDashboard', 'FleetVisualCommandCenter', 'MachineCommandCenter']) {
      assert.equal(source.includes(retired), false, `${routePath} must not render retired ${retired}`);
    }
  }
});

test('specialist telemetry routes share the rebuilt workspace frame', async () => {
  const frame = await read('components/telemetry-platform/SpecialistWorkspaceFrame.tsx');
  assert.match(frame, /data-specialist-workspace="televend-v3"/);
  assert.match(frame, /<h1>\{title\}<\/h1>/);
  assert.match(frame, /SpecialistWorkspaceFrame\.module\.css/);

  for (const routePath of [
    'app/telemetry/devices/page.tsx',
    'app/telemetry/test-center/page.tsx',
    'app/map/page.tsx',
    'app/products/page.tsx',
  ]) {
    const source = await read(routePath);
    assert.match(source, /<SpecialistWorkspaceFrame/);
  }
});

test('telemetry presentation is component-owned rather than legacy global surface markup', async () => {
  const components = [
    'TelevendFleetDashboard',
    'MachineFleetBrowser',
    'MachineDetail',
    'AlarmCenter',
    'TelemetryAnalytics',
    'ComparisonLineChart',
  ];

  for (const component of components) {
    const source = await read(`components/telemetry-platform/${component}.tsx`);
    assert.match(source, new RegExp(`import styles from './${component}\\.module\\.css';`));
    for (const retiredClass of ['neo-card', 'workspace-template-frame', 'cx-dashboard-', 'monday-']) {
      assert.equal(source.includes(retiredClass), false, `${component} must not contain ${retiredClass}`);
    }
  }
});
