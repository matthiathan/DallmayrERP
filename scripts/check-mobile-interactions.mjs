import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const [search, mobile, responsive, application, responsiveAuthority, hygiene, shell, machines] = await Promise.all([
  readFile(path.join(root, 'components', 'ui', 'GlobalSearch.tsx'), 'utf8'),
  readFile(path.join(root, 'components', 'layout', 'MobileNavigation.tsx'), 'utf8'),
  readFile(path.join(root, 'app', 'responsive-mobile-tablet.css'), 'utf8'),
  readFile(path.join(root, 'app', 'styles', 'application.css'), 'utf8'),
  readFile(path.join(root, 'app', 'styles', 'application', 'responsive.css'), 'utf8'),
  readFile(path.join(root, 'components', 'layout', 'MobileBrowserHygiene.tsx'), 'utf8'),
  readFile(path.join(root, 'components', 'layout', 'AppShell.tsx'), 'utf8'),
  readFile(path.join(root, 'components', 'features', 'MachinesWorkspace.tsx'), 'utf8'),
]);

const failures = [];
function requireSource(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}

requireSource(search, /type:\s*'Page'/, 'Global Search must support page/module results.');
requireSource(search, /client\.from\('telemetry_devices'\)/, 'Global Search must search telemetry devices for every authenticated account.');
if (/userDetails\?\.role|isNavItemAllowed/.test(search)) failures.push('Global Search must not reintroduce role filtering.');
requireSource(search, /dallmayr-open-global-search/, 'Global Search must expose a direct responsive open event.');
requireSource(search, /createPortal\(/, 'Global Search must render outside page stacking contexts.');

requireSource(mobile, /createPortal\(/, 'Responsive navigation must render through a body portal.');
requireSource(mobile, /document\.body/, 'Responsive navigation portal must target document.body.');
requireSource(mobile, /aria-modal="true"/, 'Responsive navigation must expose modal semantics.');
requireSource(mobile, /document\.body\.style\.overflow\s*=\s*'hidden'/, 'Only the open portal navigation should lock document scrolling.');
requireSource(mobile, /event\.key === 'Escape'/, 'Responsive navigation must close with Escape.');
requireSource(mobile, /event\.key !== 'Tab'/, 'Responsive navigation must trap keyboard focus.');
requireSource(mobile, /window\.dispatchEvent\(new Event\(OPEN_SEARCH_EVENT\)\)/, 'Bottom Search must open Global Search directly.');
requireSource(mobile, /item\.href === homePath \|\| item\.href === '\/work' \|\| item\.href === '\/machines' \|\| item\.href === '\/alerts'/, 'Featured mobile destinations must not be duplicated in grouped navigation.');
requireSource(shell, /<strong>\{activeTitle\}<\/strong>/, 'Mobile header must expose the current page title, not only its section.');
if (/if \(!menuOpen\) return;[\s\S]*document\.body\.style\.overflow/.test(shell)) failures.push('AppShell must not compete with the portal drawer for mobile scroll locking.');
requireSource(machines, /fleet-mobile-machine-list/, 'Machines must expose a phone-native card register.');
requireSource(machines, /fleet-desktop-machine-table/, 'Desktop machine table must be independently hideable on phones.');

requireSource(application, /@import ['"]\.\/application\/responsive\.css['"];/, 'Application registry must delegate responsive ownership to the responsive authority manifest.');
requireSource(responsiveAuthority, /@import ['"]\.\.\/\.\.\/responsive-mobile-tablet\.css['"];/, 'Unified responsive stylesheet must be registered by the responsive authority.');
if (!responsiveAuthority.trim().endsWith("@import '../../responsive-mobile-tablet.css';")) {
  failures.push('Unified responsive stylesheet must remain the final responsive authority import.');
}
for (const retired of ['mobile-functional-experience.css', 'mobile-menu-stacking-fix.css', 'mobile-overhaul.css', 'mobile-universal-phone.css', 'mobile-browser-native.css']) {
  if (application.includes(retired) || responsiveAuthority.includes(retired)) failures.push(`Retired responsive stylesheet ${retired} is still registered.`);
}

requireSource(responsive, /^\/\*[\s\S]*@media \(max-width: 900px\), \(max-width: 1366px\) and \(hover: none\) and \(pointer: coarse\) \{/m, 'Responsive contract must cover phones plus touch tablets.');
requireSource(responsive, /\.app-shell\s*>\s*\.mobile-nav-backdrop[\s\S]*display:\s*none\s*!important/m, 'Duplicate in-shell backdrop must be suppressed.');
requireSource(responsive, /\.mobile-nav-portal-root[\s\S]*position:\s*fixed\s*!important/m, 'Portal navigation must own a fixed viewport layer.');
requireSource(responsive, /\.mobile-nav-directory[\s\S]*overflow-y:\s*auto\s*!important/m, 'Navigation directory must scroll independently.');
requireSource(responsive, /\.global-search-dialog[\s\S]*max-height:/m, 'Search dialog must fit the visual viewport.');
requireSource(responsive, /\.global-search-results[\s\S]*overflow-y:\s*auto\s*!important/m, 'Search results must scroll independently.');
requireSource(responsive, /\.erp-table-scroll[\s\S]*overflow-x:\s*auto\s*!important/m, 'Data tables must scroll locally.');
requireSource(responsive, /font-size:\s*16px\s*!important/m, 'Form controls must prevent iOS focus zoom.');
requireSource(responsive, /\.fleet-mobile-machine-list[\s\S]*display:\s*grid\s*!important/m, 'Phone machine register must use native cards instead of a desktop-width table.');
requireSource(responsive, /\.fleet-desktop-machine-table[\s\S]*display:\s*none\s*!important/m, 'Desktop machine table must be hidden when phone cards are active.');
requireSource(responsive, /\.fleet-search input,[\s\S]*font-size:\s*16px\s*!important/m, 'Fleet form controls must reassert 16px text after feature-specific styles.');
requireSource(responsive, /\.messaging-layout/, 'Responsive messaging rules are required.');
requireSource(responsive, /\.mobile-quick-bar[\s\S]*position:\s*fixed\s*!important/m, 'Bottom navigation must remain reachable.');
requireSource(responsive, /var\(--ui-canvas/, 'Responsive colours must inherit desktop design tokens.');
requireSource(responsive, /@media \(min-width: 901px\) and \(max-width: 1366px\) and \(hover: none\) and \(pointer: coarse\)/, 'Landscape touch-tablet rules are required.');
requireSource(responsive, /@media \(max-width: 900px\) and \(max-height: 520px\) and \(orientation: landscape\)/, 'Short landscape-phone rules are required.');

requireSource(hygiene, /max-width: 1366px.*hover: none.*pointer: coarse/, 'Runtime responsive detection must include touch tablets.');
requireSource(hygiene, /media\.addEventListener\?\.\('change'/, 'Runtime must react to orientation/device-mode changes.');
requireSource(hygiene, /body\.style\.removeProperty\('overflow'\)/, 'Route hygiene must clear stale overflow locks.');

if (failures.length) {
  failures.forEach((failure) => console.error(`Mobile/tablet interaction check failed: ${failure}`));
  process.exit(1);
}

console.log('Responsive interaction contract passed: phones and touch tablets use one portal/navigation/search/form/table/messaging contract through the explicit responsive authority while desktop styles remain isolated.');
