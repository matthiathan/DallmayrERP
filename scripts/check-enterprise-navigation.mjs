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

const shellNavigation = read('components/layout/appShellNavigation.ts');
const appShell = read('components/layout/AppShell.tsx');
const desktopNavigation = read('components/layout/DesktopNavigationRail.tsx');
const globalSearch = read('components/ui/GlobalSearch.tsx');

for (const href of [
  "href: '/'",
  "href: '/machines'",
  "href: '/alerts'",
  "href: '/telemetry'",
  "href: '/telemetry/reports'",
  "href: '/telemetry/test-center'",
  "href: '/map'",
  "href: '/products'",
  "href: '/telemetry/devices'",
]) {
  requireText('app shell navigation', shellNavigation, href, `the shared telemetry catalogue is missing ${href}.`);
}

requireText(
  'app shell navigation',
  shellNavigation,
  'selectActiveNavigationHref(pathname, allNavigationItems.map((item) => item.href))',
  'active navigation must resolve the most specific telemetry route.',
);
requireText(
  'app shell navigation',
  shellNavigation,
  'allowedPath: canAccessShellPath(pathname)',
  'the shell must reject retired ERP routes.',
);
forbid(
  'app shell navigation',
  shellNavigation,
  'BusinessRole',
  'telemetry navigation must not depend on ERP roles.',
);
requireText(
  'app shell',
  appShell,
  'activeHref={activeHref}',
  'the canonical active route must be passed to desktop navigation.',
);
forbid(
  'app shell',
  appShell,
  'roleLabels',
  'the telemetry shell must not display or evaluate ERP roles.',
);
requireText(
  'desktop navigation',
  desktopNavigation,
  'const active = activeHref === item.href;',
  'desktop navigation must derive active state from the canonical route only.',
);
requireText(
  'desktop navigation',
  desktopNavigation,
  "aria-current={active ? 'page' : undefined}",
  'desktop navigation must expose only the canonical active item as current.',
);
forbid(
  'global search',
  globalSearch,
  'userDetails?.role',
  'global telemetry search must expose the same pages to every authenticated account.',
);
requireText(
  'global search',
  globalSearch,
  "client.from('telemetry_devices')",
  'global search must search telemetry devices for every authenticated account.',
);

if (failures.length) {
  console.error('Telemetry navigation contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Telemetry navigation contract passed: the rebuilt authenticated workspace exposes all telemetry pages without role gates.');
