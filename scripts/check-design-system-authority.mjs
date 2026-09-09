import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];

function requireText(sourceName, source, expected, message) {
  if (!source.includes(expected)) failures.push(`${sourceName}: ${message}`);
}

function forbid(sourceName, source, forbidden, message) {
  if (source.includes(forbidden)) failures.push(`${sourceName}: ${message}`);
}

const shell = read('components/layout/AppShell.tsx');
const desktopNavigation = read('components/layout/DesktopNavigationRail.tsx');
const fleet = read('components/telemetry-platform/TelevendFleetDashboard.tsx');
const machines = read('components/telemetry-platform/MachineFleetBrowser.tsx');
const machineDetail = read('components/telemetry-platform/MachineDetail.tsx');
const alarms = read('components/telemetry-platform/AlarmCenter.tsx');
const analytics = read('components/telemetry-platform/TelemetryAnalytics.tsx');
const specialist = read('components/telemetry-platform/SpecialistWorkspaceFrame.tsx');
const home = read('app/page.tsx');
const machinePage = read('app/machines/page.tsx');
const alertPage = read('app/alerts/page.tsx');
const analyticsPage = read('app/telemetry/page.tsx');

requireText('application shell', shell, "TelemetryPlatformShell.module.css", 'the rebuilt platform shell must own the authenticated application chrome.');
requireText('application shell', shell, 'data-platform-shell="telemetry-v3"', 'the active shell must expose the rebuilt platform marker.');
requireText('desktop navigation', desktopNavigation, "TelemetryPlatformShell.module.css", 'desktop navigation must share the rebuilt shell styling authority.');

for (const [name, source, marker] of [
  ['fleet dashboard', fleet, 'data-fleet-dashboard="televend-v3"'],
  ['machine browser', machines, 'data-machine-browser="televend-v3"'],
  ['machine detail', machineDetail, 'data-machine-detail="televend-v3"'],
  ['alarm center', alarms, 'data-alarm-center="televend-v3"'],
  ['analytics', analytics, 'data-analytics="televend-v3"'],
  ['specialist workspace', specialist, 'data-specialist-workspace="televend-v3"'],
]) {
  requireText(name, source, marker, `${name} must remain owned by the rebuilt telemetry platform.`);
  requireText(name, source, "styles from './", `${name} must use an owned CSS module rather than legacy global route styling.`);
}

requireText('Fleet Overview route', home, 'TelevendFleetDashboard', 'Fleet Overview must render the rebuilt dashboard.');
requireText('Machines route', machinePage, 'MachineFleetBrowser', 'Machines must render the rebuilt fleet browser.');
requireText('Alerts route', alertPage, 'AlarmCenter', 'Alerts must render the rebuilt alarm center.');
requireText('Analytics route', analyticsPage, 'TelemetryAnalytics', 'Analytics must render the rebuilt analytics workspace.');

for (const [name, source] of [
  ['Fleet Overview route', home],
  ['Machines route', machinePage],
  ['Alerts route', alertPage],
  ['Analytics route', analyticsPage],
]) {
  forbid(name, source, 'MachineTelemetryOverview', 'active telemetry routes must not depend on the retired overview implementation.');
  forbid(name, source, 'FleetVisualCommandCenter', 'active telemetry routes must not depend on the retired visual command center.');
  forbid(name, source, 'TelemetryDashboard', 'active telemetry routes must not depend on the retired analytics implementation.');
}

if (failures.length > 0) {
  console.error('Telemetry design-system authority contract failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Telemetry design-system authority contract passed: the rebuilt Televend-style platform owns active shell and route presentation.');
