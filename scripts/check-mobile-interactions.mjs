import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const files = {
  search: path.join(root, 'components', 'ui', 'GlobalSearch.tsx'),
  mobile: path.join(root, 'components', 'layout', 'MobileNavigation.tsx'),
  styles: path.join(root, 'app', 'ui-stabilization-contract.css'),
  mobileStyles: path.join(root, 'app', 'mobile-functional-experience.css'),
  stackingFix: path.join(root, 'app', 'mobile-menu-stacking-fix.css'),
  overhaul: path.join(root, 'app', 'mobile-overhaul.css'),
  applicationStyles: path.join(root, 'app', 'styles', 'application.css'),
};

const [search, mobile, styles, mobileStyles, stackingFix, overhaul, applicationStyles] = await Promise.all([
  readFile(files.search, 'utf8'),
  readFile(files.mobile, 'utf8'),
  readFile(files.styles, 'utf8'),
  readFile(files.mobileStyles, 'utf8'),
  readFile(files.stackingFix, 'utf8'),
  readFile(files.overhaul, 'utf8'),
  readFile(files.applicationStyles, 'utf8'),
]);

const failures = [];
function requireSource(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}

requireSource(search, /type:\s*'Page'/, 'Global Search must support page/module results.');
requireSource(search, /isNavItemAllowed\(userDetails\.role, item\)/, 'Page results must be filtered by the signed-in role.');
requireSource(search, /dallmayr-open-global-search/, 'Global Search must expose the direct mobile open event contract.');
requireSource(search, /createPortal\(/, 'Global Search must render outside page stacking contexts.');
requireSource(mobile, /createPortal\(/, 'Mobile navigation must render through a body portal.');
requireSource(mobile, /document\.body/, 'Mobile navigation portal must target document.body.');
requireSource(mobile, /mobile-nav-portal-root/, 'Mobile navigation portal root is missing.');
requireSource(mobile, /aria-modal="true"/, 'Mobile navigation must expose modal semantics.');
requireSource(mobile, /document\.body\.style\.overflow\s*=\s*'hidden'/, 'Open mobile navigation must lock page scrolling.');
requireSource(mobile, /event\.key === 'Escape'/, 'Mobile navigation must close with Escape.');
requireSource(mobile, /event\.key !== 'Tab'/, 'Mobile navigation must trap keyboard focus.');
requireSource(mobile, /aria-label="Open global search"/, 'The mobile quick bar must expose an accessible Search action.');
requireSource(mobile, /window\.dispatchEvent\(new Event\(OPEN_SEARCH_EVENT\)\)/, 'The mobile quick bar must open Global Search directly.');
requireSource(applicationStyles, /@import ['"]\.\.\/mobile-overhaul\.css['"];/, 'The final mobile overhaul stylesheet must be registered.');
requireSource(overhaul, /^\/\* Final phone-only usability contract[\s\S]*@media \(max-width: 760px\) \{/m, 'The final mobile overhaul must be scoped to phones.');
requireSource(overhaul, /\.app-shell\s*>\s*\.mobile-nav-backdrop[\s\S]*display:\s*none\s*!important/m, 'The legacy in-shell mobile backdrop must be disabled on phones.');
requireSource(overhaul, /\.mobile-nav-portal-root[\s\S]*position:\s*fixed\s*!important/m, 'Portal navigation must own a fixed viewport layer.');
requireSource(overhaul, /\.mobile-nav-portal-root\s*>\s*\.mobile-nav-panel[\s\S]*height:\s*100dvh\s*!important/m, 'Portal navigation must fill the phone viewport.');
requireSource(overhaul, /\.mobile-nav-directory[\s\S]*overflow-y:\s*auto\s*!important/m, 'Mobile navigation directory must scroll independently.');
requireSource(overhaul, /\.global-search-dialog[\s\S]*height:\s*100dvh\s*!important/m, 'Mobile search must fill the phone viewport.');
requireSource(overhaul, /\.global-search-results[\s\S]*overflow-y:\s*auto\s*!important/m, 'Mobile search results must scroll independently.');
requireSource(overhaul, /\.erp-table-scroll[\s\S]*overflow-x:\s*auto\s*!important/m, 'Mobile tables must remain horizontally scrollable.');
requireSource(overhaul, /font-size:\s*16px\s*!important/m, 'Mobile form controls must prevent iOS focus zoom.');
requireSource(overhaul, /\.messaging-layout[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)\s*!important/m, 'Messaging must use a phone-safe single-column layout.');
requireSource(overhaul, /\.mobile-quick-bar[\s\S]*min-height:/m, 'Mobile bottom navigation must reserve a stable touch area.');

for (const source of [mobileStyles, stackingFix, overhaul]) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!withoutComments.startsWith('@media (max-width: 760px) {')) {
    failures.push('A mobile-only stylesheet contains rules outside the 760px phone scope.');
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`Mobile interaction check failed: ${failure}`);
  process.exit(1);
}

console.log('Mobile interaction contract passed: portal overlays, focus/scroll management, direct search, touch forms, contained tables, messaging, bottom navigation and desktop isolation safeguards are present.');
