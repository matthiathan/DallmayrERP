import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function collectFiles(relativeDirectory, predicate) {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) files.push(...await collectFiles(relativePath, predicate));
    else if (predicate(relativePath)) files.push(relativePath);
  }
  return files;
}

const routeContracts = [
  ['app/page.tsx', 'TelevendFleetDashboard'],
  ['app/machines/page.tsx', 'MachineFleetBrowser'],
  ['app/machines/[id]/page.tsx', 'MachineDetail'],
  ['app/alerts/page.tsx', 'AlarmCenter'],
  ['app/telemetry/page.tsx', 'TelemetryAnalytics'],
  ['app/telemetry/devices/page.tsx', 'SpecialistWorkspaceFrame'],
  ['app/telemetry/test-center/page.tsx', 'SpecialistWorkspaceFrame'],
  ['app/map/page.tsx', 'SpecialistWorkspaceFrame'],
  ['app/products/page.tsx', 'SpecialistWorkspaceFrame'],
];

for (const [routePath, expectedOwner] of routeContracts) {
  if (!(await exists(routePath))) {
    fail(`${routePath} is missing from the telemetry application.`);
    continue;
  }
  const source = await read(routePath);
  if (!source.includes(expectedOwner)) {
    fail(`${routePath} must render through ${expectedOwner}.`);
  }
}

const appFiles = await collectFiles('app', (fileName) => /\.(?:ts|tsx)$/.test(fileName));
const retiredPresentationOwners = [
  'FleetVisualCommandCenter',
  'MachineCommandCenter',
  'MachineTelemetryOverview',
  'TelemetryDashboard',
  'FleetAlertPulse',
  'MachinesWorkspace',
  'OperationsManagerDashboard',
  'EnterpriseCommandCentre',
  'RoleTodayWorkspace',
];

for (const appFile of appFiles) {
  const source = await read(appFile);
  for (const retiredOwner of retiredPresentationOwners) {
    if (source.includes(retiredOwner)) {
      fail(`${appFile} still references retired presentation owner ${retiredOwner}.`);
    }
  }
}

const platformDirectory = 'components/telemetry-platform';
const platformFiles = await readdir(path.join(root, platformDirectory));
const componentFiles = platformFiles.filter((fileName) => fileName.endsWith('.tsx'));
for (const fileName of componentFiles) {
  const source = await read(`${platformDirectory}/${fileName}`);
  const localStyleImports = [...source.matchAll(/import\s+styles\s+from\s+['"]\.\/(.+?\.module\.css)['"];?/g)].map((match) => match[1]);
  for (const styleImport of localStyleImports) {
    if (!(await exists(`${platformDirectory}/${styleImport}`))) {
      fail(`${platformDirectory}/${fileName} imports missing CSS module ${styleImport}.`);
    }
  }

  for (const legacyClass of ['neo-card', 'workspace-template-frame', 'cx-dashboard-', 'monday-', 'dynamics-']) {
    if (source.includes(legacyClass)) {
      fail(`${platformDirectory}/${fileName} contains retired global presentation class ${legacyClass}.`);
    }
  }
}

for (const retiredPresentationFile of [
  'app/concentrix-dallmayr-dashboard.css',
  'app/concentrix-execution-details.css',
  'app/styles/active-mobile-workspaces.css',
  'app/mobile-functional-experience.css',
  'app/mobile-menu-stacking-fix.css',
  'app/mobile-overhaul.css',
  'app/mobile-universal-phone.css',
  'app/mobile-browser-native.css',
]) {
  if (await exists(retiredPresentationFile)) {
    fail(`${retiredPresentationFile} must remain removed; rebuilt telemetry presentation is component-owned.`);
  }
}

for (const retiredSourcePath of [
  'components/boards',
]) {
  if (await exists(retiredSourcePath)) {
    fail(`${retiredSourcePath} must remain removed; the customer-board ERP workspace is outside the telemetry application.`);
  }
}

if (failures.length) {
  console.error('Telemetry feature style ownership contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Telemetry feature style ownership contract passed across ${appFiles.length} application source files and ${componentFiles.length} telemetry-platform components.`);
