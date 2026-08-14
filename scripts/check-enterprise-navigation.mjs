import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];

function requireText(sourceName, source, expected, message) {
  if (!source.includes(expected)) failures.push(`${sourceName}: ${message}`);
}

const shell = read('components/layout/appShellNavigation.ts');
const enterpriseNavigation = read('lib/navigation/enterpriseNavigation.ts');

requireText(
  'app shell navigation',
  shell,
  "import { groupEnterpriseNavigationSections } from '@/lib/navigation/enterpriseNavigation';",
  'the shell must import the enterprise grouping contract.',
);
requireText(
  'app shell navigation',
  shell,
  'groupEnterpriseNavigationSections(role, orderedNavigationSections)',
  'the role-filtered navigation must be regrouped through the enterprise navigation contract.',
);
requireText(
  'enterprise navigation',
  enterpriseNavigation,
  "new Set<BusinessRole>(['admin', 'executive'])",
  'task-oriented regrouping must remain limited to administrator and executive roles.',
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
