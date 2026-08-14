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
const enterpriseNavigation = read('lib/navigation/enterpriseNavigation.ts');

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
