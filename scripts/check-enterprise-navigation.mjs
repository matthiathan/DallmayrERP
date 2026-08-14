import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];

function requireText(sourceName, source, expected, message) {
  if (!source.includes(expected)) failures.push(`${sourceName}: ${message}`);
}

const shellNavigation = read('components/layout/appShellNavigation.ts');
const appShell = read('components/layout/AppShell.tsx');
const desktopNavigation = read('components/layout/DesktopNavigationRail.tsx');
const mobileNavigation = read('components/layout/MobileNavigation.tsx');
const globalSearch = read('components/ui/GlobalSearch.tsx');
const enterpriseNavigation = read('lib/navigation/enterpriseNavigation.ts');
const supplementalNavigation = read('lib/navigation/supplementalNavigation.ts');

requireText(
  'app shell navigation',
  shellNavigation,
  "import { groupEnterpriseNavigationSections } from '@/lib/navigation/enterpriseNavigation';",
  'the shell must import the enterprise grouping contract.',
);
requireText(
  'app shell navigation',
  shellNavigation,
  'groupEnterpriseNavigationSections(role, orderedNavigationSections)',
  'the role-filtered navigation must be regrouped through the enterprise navigation contract.',
);
requireText(
  'app shell navigation',
  shellNavigation,
  'getSupplementalNavigationSections(role, MESSAGING_ENABLED)',
  'the shell must consume the shared Messages and Telemetry navigation catalogue.',
);
requireText(
  'app shell navigation',
  shellNavigation,
  'selectActiveNavigationHref(pathname, allNavigationItems.map((item) => item.href))',
  'active navigation must resolve the most specific authorized route.',
);
requireText(
  'enterprise navigation',
  enterpriseNavigation,
  "new Set<BusinessRole>(['admin', 'executive'])",
  'task-oriented regrouping must remain limited to administrator and executive roles.',
);
requireText(
  'supplemental navigation',
  supplementalNavigation,
  "href: '/telemetry/devices'",
  'administrator telemetry device navigation must remain in the shared supplemental catalogue.',
);
requireText(
  'app shell',
  appShell,
  'activeHref={activeHref}',
  'the canonical active route must be passed to desktop and mobile navigation surfaces.',
);
requireText(
  'desktop navigation',
  desktopNavigation,
  "aria-current={activeHref === item.href ? 'page' : undefined}",
  'desktop navigation must mark only the canonical route as current.',
);
requireText(
  'mobile navigation',
  mobileNavigation,
  'const active = activeHref === item.href;',
  'mobile navigation must mark only the canonical route as current.',
);
requireText(
  'global search',
  globalSearch,
  "const MESSAGING_ENABLED = process.env.NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED === 'true';",
  'global search must use the same opt-in messaging flag semantics as the shell.',
);
requireText(
  'global search',
  globalSearch,
  'getSupplementalNavigationSections(userDetails.role, MESSAGING_ENABLED)',
  'global search must consume the shared Messages and Telemetry navigation catalogue.',
);
requireText(
  'global search',
  globalSearch,
  'groupEnterpriseNavigationSections(userDetails.role, [',
  'global search page subtitles must use the same task-oriented enterprise section taxonomy.',
);

for (const heading of ['Work', 'Customers & Assets', 'Inventory', 'Commercial', 'Insights', 'Administration']) {
  requireText(
    'enterprise navigation',
    enterpriseNavigation,
    `'${heading}'`,
    `the canonical ${heading} enterprise navigation area is missing.`,
  );
}

if (failures.length) {
  console.error('Enterprise navigation contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Enterprise navigation contract passed.');
