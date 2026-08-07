import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const files = {
  search: path.join(root, 'components', 'ui', 'GlobalSearch.tsx'),
  mobile: path.join(root, 'components', 'layout', 'MobileNavigation.tsx'),
  styles: path.join(root, 'app', 'ui-stabilization-contract.css'),
  mobileStyles: path.join(root, 'app', 'mobile-functional-experience.css'),
  applicationStyles: path.join(root, 'app', 'styles', 'application.css'),
};

const [search, mobile, styles, mobileStyles, applicationStyles] = await Promise.all([
  readFile(files.search, 'utf8'),
  readFile(files.mobile, 'utf8'),
  readFile(files.styles, 'utf8'),
  readFile(files.mobileStyles, 'utf8'),
  readFile(files.applicationStyles, 'utf8'),
]);

const failures = [];
function requireSource(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}

requireSource(search, /type:\s*'Page'/, 'Global Search must support page/module results.');
requireSource(search, /isNavItemAllowed\(userDetails\.role, item\)/, 'Page results must be filtered by the signed-in role.');
requireSource(search, /dallmayr-open-global-search/, 'Global Search must expose the direct mobile open event contract.');
requireSource(search, /Find a page, record or task/, 'Global Search must identify page and record search to assistive technology.');
requireSource(mobile, /aria-label="Open global search"/, 'The mobile quick bar must expose an accessible Search action.');
requireSource(mobile, /window\.dispatchEvent\(new Event\(OPEN_SEARCH_EVENT\)\)/, 'The mobile quick bar must open Global Search directly instead of relying on a hidden drawer trigger.');
requireSource(mobile, /mobile-nav-panel/, 'The mobile navigation drawer contract is missing.');
requireSource(styles, /\.mobile-nav-panel[\s\S]*z-index:\s*(?:[2-9]\d{3,}|1\d{4,})/m, 'The base mobile navigation drawer must have an explicit high stacking layer.');
requireSource(styles, /\.global-search-overlay[\s\S]*z-index:\s*(?:[2-9]\d{3,}|1\d{4,})/m, 'Global Search must render above the mobile shell.');
requireSource(applicationStyles, /@import ['"]\.\.\/ui-stabilization-contract\.css['"];\s*@import ['"]\.\.\/mobile-functional-experience\.css['"];/, 'The mobile-only stylesheet must load after desktop stabilization so phone rules are authoritative.');
requireSource(mobileStyles, /^\/\* Dedicated mobile application experience[\s\S]*@media \(max-width: 760px\) \{/m, 'The dedicated mobile experience must be scoped to the phone breakpoint.');
requireSource(mobileStyles, /\.mobile-nav-panel:not\(\[hidden\]\)[\s\S]*height:\s*100dvh\s*!important/m, 'The mobile navigation drawer must use the full phone viewport.');
requireSource(mobileStyles, /\.mobile-nav-directory[\s\S]*overflow-y:\s*auto\s*!important/m, 'The mobile navigation directory must scroll independently.');
requireSource(mobileStyles, /\.mobile-quick-bar[\s\S]*position:\s*fixed\s*!important/m, 'The mobile bottom navigation must remain fixed and reachable.');
requireSource(mobileStyles, /\.global-search-dialog[\s\S]*height:\s*100dvh\s*!important/m, 'Mobile Global Search must use a full-height phone sheet.');
requireSource(mobileStyles, /\.erp-table-scroll[\s\S]*overflow-x:\s*auto\s*!important/m, 'Mobile tables must support contained horizontal scrolling.');
requireSource(mobileStyles, /font-size:\s*16px\s*!important;\s*\/\* prevents iOS input zoom \*\//m, 'Mobile inputs must prevent iOS focus zoom.');

const firstMediaIndex = mobileStyles.indexOf('@media (max-width: 760px)');
const firstRuleIndex = mobileStyles.search(/(^|\n)\s*[^/@\s][^{]*\{/m);
if (firstRuleIndex !== -1 && (firstMediaIndex === -1 || firstRuleIndex < firstMediaIndex)) {
  failures.push('Mobile-only stylesheet contains an unscoped rule that could alter the desktop application.');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`Mobile interaction check failed: ${failure}`);
  process.exit(1);
}

console.log('Mobile interaction contract passed: direct search, full-height navigation, desktop isolation, touch sizing, mobile tables, stacking and scrolling safeguards are present.');
