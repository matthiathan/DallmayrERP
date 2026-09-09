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
const shellNavigation = read('components/layout/appShellNavigation.ts');
const desktop = read('components/layout/DesktopNavigationRail.tsx');
const breadcrumbs = read('components/ui/Breadcrumbs.tsx');
const pageNavigation = read('lib/navigation/pageNavigation.ts');
const shell = read('components/layout/AppShell.tsx');

requireText('terminology', terminology, "FLEET_OVERVIEW_LABEL = 'Fleet Overview'", 'Fleet Overview must remain the telemetry landing label.');
requireText('shell navigation', shellNavigation, "{ href: '/', label: 'Fleet Overview'", 'Fleet Overview must be the telemetry home route.');
requireText('shell navigation', shellNavigation, "{ href: '/machines', label: 'Machines'", 'Machines must remain a primary telemetry route.');
requireText('shell navigation', shellNavigation, "{ href: '/alerts', label: 'Alerts'", 'Alerts must remain a primary telemetry route.');
requireText('shell navigation', shellNavigation, "{ href: '/telemetry', label: 'Analytics'", 'Analytics must remain a primary telemetry route.');
forbid('shell navigation', shellNavigation, "href: '/workspace'", 'obsolete ERP workspace navigation must not return.');
forbid('shell navigation', shellNavigation, "href: '/work'", 'obsolete ERP work navigation must not return.');

requireText('desktop navigation', desktop, 'title={FLEET_OVERVIEW_LABEL}', 'the telemetry landing link must use the canonical Fleet Overview label.');
requireText('desktop navigation', desktop, 'aria-label={FLEET_OVERVIEW_OPEN_LABEL}', 'the brand link must expose Open Fleet Overview to assistive technology.');
forbid('desktop navigation', desktop, 'Dallmayr ERP home', 'ERP-era accessibility copy must not return.');

requireText('breadcrumbs', breadcrumbs, '<Link href="/">{FLEET_OVERVIEW_LABEL}</Link>', 'breadcrumbs must root telemetry pages at Fleet Overview.');
forbid('breadcrumbs', breadcrumbs, "pathname === '/workspace'", 'breadcrumbs must not retain obsolete /workspace behavior.');
requireText('page navigation', pageNavigation, "{ href: '/', label: FLEET_OVERVIEW_LABEL }", 'fallback navigation must return to Fleet Overview.');
requireText('page navigation', pageNavigation, "segments[0] === 'machines'", 'machine detail navigation must return to Machines.');
forbid('page navigation', pageNavigation, "segments[0] === 'work'", 'obsolete ERP dynamic routes must not return.');

requireText('application shell', shell, 'data-platform-shell="telemetry-v3"', 'the active application shell must identify the rebuilt telemetry platform.');
requireText('application shell', shell, '>Open Fleet Overview</Link>', 'access-denied recovery must return users to Fleet Overview.');
forbid('application shell', shell, "router.replace('/workspace')", 'the authenticated shell must not redirect to the obsolete ERP workspace.');

if (failures.length > 0) {
  console.error('Navigation terminology contract failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Navigation terminology contract passed: the rebuilt application is telemetry-only and consistently rooted at Fleet Overview.');
