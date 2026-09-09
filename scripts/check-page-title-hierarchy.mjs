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
const specialist = read('components/telemetry-platform/SpecialistWorkspaceFrame.tsx');
const machines = read('components/telemetry-platform/MachineFleetBrowser.tsx');
const alarms = read('components/telemetry-platform/AlarmCenter.tsx');
const analytics = read('components/telemetry-platform/TelemetryAnalytics.tsx');
const machineDetail = read('components/telemetry-platform/MachineDetail.tsx');

requireText(
  'application shell',
  shell,
  "activeSection?.heading ?? 'Telemetry'",
  'the rebuilt shell must retain area-level telemetry context.',
);
requireText(
  'application shell',
  shell,
  '<strong>{activeTitle}</strong>',
  'the rebuilt top bar must expose the active telemetry route title.',
);
requireText(
  'specialist workspace',
  specialist,
  '<h1>{title}</h1>',
  'specialist workspaces must own a semantic page title.',
);
requireText(
  'specialist workspace',
  specialist,
  'data-specialist-workspace="televend-v3"',
  'specialist pages must use the rebuilt platform frame.',
);

for (const [name, source, marker] of [
  ['machines', machines, 'data-machine-browser="televend-v3"'],
  ['alerts', alarms, 'data-alarm-center="televend-v3"'],
  ['analytics', analytics, 'data-analytics="televend-v3"'],
  ['machine detail', machineDetail, 'data-machine-detail="televend-v3"'],
]) {
  requireText(name, source, marker, `${name} must remain on the rebuilt telemetry platform.`);
}

forbid('application shell', shell, 'Scheduled Call Log', 'ERP operational page titles must not return to the telemetry shell.');
forbid('application shell', shell, '/operations/service-jobs', 'removed ERP operational routes must not return.');

if (failures.length) {
  console.error('Rebuilt telemetry page hierarchy contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Rebuilt telemetry page hierarchy contract passed.');
