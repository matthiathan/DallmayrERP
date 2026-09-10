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

const layout = await read('app/layout.tsx');
const layoutCssImports = [...layout.matchAll(/import\s+['"]([^'"]+\.css)['"];?/g)].map((match) => match[1]);
if (layoutCssImports.length !== 1 || layoutCssImports[0] !== './styles/index.css') {
  fail(`app/layout.tsx must keep a single global stylesheet entry point at ./styles/index.css; found ${JSON.stringify(layoutCssImports)}.`);
}

const platformDirectory = 'components/telemetry-platform';
const shellModulePath = `${platformDirectory}/TelemetryPlatformShell.module.css`;
const shellOwner = await read('components/layout/AppShell.tsx');
if (!shellOwner.includes("import styles from '@/components/telemetry-platform/TelemetryPlatformShell.module.css';")) {
  fail('components/layout/AppShell.tsx must own the application shell through TelemetryPlatformShell.module.css.');
}

const requiredPairs = [
  'TelevendFleetDashboard',
  'MachineFleetBrowser',
  'MachineDetail',
  'MachineIdentityProfilePanel',
  'AlarmCenter',
  'TelemetryAnalytics',
  'ComparisonLineChart',
  'SpecialistWorkspaceFrame',
];

for (const name of requiredPairs) {
  const componentPath = `${platformDirectory}/${name}.tsx`;
  const modulePath = `${platformDirectory}/${name}.module.css`;
  if (!(await exists(componentPath))) {
    fail(`${componentPath} is missing.`);
    continue;
  }
  if (!(await exists(modulePath))) {
    fail(`${modulePath} is missing.`);
    continue;
  }

  const source = await read(componentPath);
  const expectedImport = `import styles from './${name}.module.css';`;
  if (!source.includes(expectedImport)) {
    fail(`${componentPath} must own its presentation through ${name}.module.css.`);
  }
}

const shellStyles = await read(shellModulePath);
for (const requiredRule of [
  '--dallmayr-red: #c9151e;',
  '--dallmayr-red-dark: #a90f17;',
  'grid-template-columns: 226px minmax(0, 1fr)',
  '.desktopCollapsed',
  'grid-template-columns: 72px minmax(0, 1fr)',
  '@media (max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse)',
  'env(safe-area-inset-top)',
  'env(safe-area-inset-bottom)',
  '.mobileBottomNav',
]) {
  if (!shellStyles.includes(requiredRule)) {
    fail(`TelemetryPlatformShell.module.css is missing required shell/responsive contract: ${requiredRule}`);
  }
}

const platformFiles = await readdir(path.join(root, platformDirectory));
const moduleFiles = platformFiles.filter((name) => name.endsWith('.module.css'));
if (moduleFiles.length < requiredPairs.length + 1) {
  fail(`Expected at least ${requiredPairs.length + 1} telemetry CSS modules; found ${moduleFiles.length}.`);
}

const forbiddenLegacyTokens = [
  'concentrix',
  'monday-',
  'd365-',
  'erp-workbench',
  'workspace-template-frame',
  'cx-dashboard',
];

for (const fileName of moduleFiles) {
  const relativePath = `${platformDirectory}/${fileName}`;
  const source = await read(relativePath);
  if (/^\s*@import\s/m.test(source)) {
    fail(`${relativePath} must not import global/legacy stylesheets; telemetry presentation stays component-owned.`);
  }
  for (const token of forbiddenLegacyTokens) {
    if (source.toLowerCase().includes(token)) {
      fail(`${relativePath} contains retired presentation token ${token}.`);
    }
  }
}

for (const retiredRoute of [
  'app/onboarding/page.tsx',
  'app/operations/service-jobs/page.tsx',
  'app/operations/deliveries/page.tsx',
  'app/executive/reports/page.tsx',
]) {
  if (await exists(retiredRoute)) {
    fail(`${retiredRoute} must remain removed from the telemetry-only application.`);
  }
}

if (failures.length) {
  console.error('Telemetry style architecture contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Telemetry style architecture contract passed: ${moduleFiles.length} component-owned CSS modules, Dallmayr shell tokens and mobile/tablet authority are intact.`);
