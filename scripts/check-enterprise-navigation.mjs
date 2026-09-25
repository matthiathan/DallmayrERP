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
  "if (accountScope === 'client') return clientCanAccessPath(pathname);",
  'client navigation must be governed by the explicit customer-portal allowlist.',
);
requireText(
  'app shell navigation',
  shellNavigation,
  'allowedPath: canAccessShellPath(pathname, accountScope, role)',
  'the shell must reject retired ERP routes and account-restricted telemetry routes.',
);
requireText(
  'app shell navigation',
  shellNavigation,
  "return pathname.startsWith('/machines/');",
  'client accounts must be able to open only nested machine dashboards beyond exact allowlisted routes.',
);
forbid(
  'app shell navigation',
  shellNavigation,
  'BusinessRole',
  'telemetry navigation must not import the legacy ERP BusinessRole model.',
);
requireText(
  'app shell',
  appShell,
  'activeHref={activeHref}',
  'the canonical active route must be passed to desktop navigation.',
);
requireText(
  'app shell',
  appShell,
  "const accountScope = businessProfile?.user.account_scope === 'client' ? 'client' : 'dallmayr';",
  'the shell must resolve the authenticated account tenancy before rendering navigation.',
);
forbid(
  'app shell',
  appShell,
  'roleLabels',
  'the telemetry shell must not display legacy ERP role labels.',
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
requireText(
  'global search',
  globalSearch,
  "import { canAccessShellPath, telemetryNavigationSections } from '@/components/layout/appShellNavigation';",
  'global search must use the same account-aware telemetry route authority as the shell.',
);
requireText(
  'global search',
  globalSearch,
  'telemetryNavigationSections.flatMap',
  'global search must enumerate telemetry pages from the canonical navigation catalogue.',
);
requireText(
  'global search',
  globalSearch,
  '.filter((item) => canAccessShellPath(item.href, accountScope, role))',
  'page search results must be filtered by the authenticated account scope.',
);
requireText(
  'global search',
  globalSearch,
  'QUICK_ACTIONS.filter((item) => canAccessShellPath(item.href, accountScope, role))',
  'global-search quick actions must be filtered by the same account-aware route guard.',
);
forbid(
  'global search',
  globalSearch,
  'const focusedPages =',
  'global search must not maintain a second page-search catalogue.',
);
requireText(
  'global search',
  globalSearch,
  "client.from('telemetry_devices')",
  'global search must continue to search telemetry devices while RLS enforces customer scope.',
);

if (failures.length) {
  console.error('Telemetry navigation contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Telemetry navigation contract passed: Dallmayr staff retain the complete telemetry workspace and client accounts are restricted to their approved customer telemetry routes.');
