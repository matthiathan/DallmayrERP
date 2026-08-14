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

const terminology = read('lib/navigation/terminology.ts');
const permissions = read('lib/auth/permissions.ts');
const desktop = read('components/layout/DesktopNavigationRail.tsx');
const mobile = read('components/layout/MobileNavigation.tsx');
const breadcrumbs = read('components/ui/Breadcrumbs.tsx');
const pageNavigation = read('lib/navigation/pageNavigation.ts');
const shell = read('components/layout/AppShell.tsx');

requireText('terminology', terminology, "TODAY_LABEL = 'Today'", 'Today must be the canonical role-landing label.');
requireText('terminology', terminology, "MY_WORK_LABEL = 'My Work'", 'My Work must be the canonical work-list label.');

const workspaceEntries = [...permissions.matchAll(/href:\s*'\/workspace',\s*label:\s*'([^']+)'/g)].map((match) => match[1]);
if (workspaceEntries.length === 0) failures.push('permissions: no /workspace navigation entry was found.');
if (workspaceEntries.some((label) => label !== 'Today')) {
  failures.push(`permissions: every /workspace navigation entry must be labelled Today; found ${workspaceEntries.join(', ')}.`);
}

requireText('desktop navigation', desktop, 'title={TODAY_LABEL}', 'the role landing link must use the canonical Today label.');
requireText('desktop navigation', desktop, 'aria-label={TODAY_OPEN_LABEL}', 'the brand link must expose Open Today to assistive technology.');
forbid('desktop navigation', desktop, 'title="Dashboard"', 'the /workspace role landing must not be renamed Dashboard.');
forbid('desktop navigation', desktop, 'Dallmayr ERP home', 'the /workspace role landing must not be renamed home in accessibility copy.');

requireText('mobile navigation', mobile, '<strong>{TODAY_LABEL}</strong>', 'the drawer and quick bar must consume the canonical Today label.');
requireText('mobile navigation', mobile, "item.href === homePath || item.href === '/work'", 'generated sections must not duplicate the fixed Today and My Work destinations.');
forbid('mobile navigation', mobile, '<strong>Dashboard</strong>', 'the role landing must not be renamed Dashboard in the drawer.');

requireText('breadcrumbs', breadcrumbs, '<Link href="/workspace">{TODAY_LABEL}</Link>', 'breadcrumbs must root nested pages at Today.');
requireText('page navigation', pageNavigation, "{ href: '/workspace', label: TODAY_LABEL }", 'mobile back navigation must fall back to Today.');
forbid('breadcrumbs', breadcrumbs, '>Workspace</Link>', 'the /workspace route must not be renamed Workspace in breadcrumbs.');
forbid('page navigation', pageNavigation, "label: 'Start Page'", 'the /workspace route must not use the ambiguous Start Page alias.');

requireText('application shell', shell, 'aria-label="Open Today workspace"', 'the application brand must identify the role landing as Today.');
requireText('application shell', shell, '>Go to Today</Link>', 'access-denied recovery must return users to Today.');

if (failures.length > 0) {
  console.error('Navigation terminology contract failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Navigation terminology contract passed: Today is the single role-landing name, My Work is stable, dashboard names remain explicit, and desktop/mobile/breadcrumb labels agree.');
