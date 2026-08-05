import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const files = {
  search: path.join(root, 'components', 'ui', 'GlobalSearch.tsx'),
  mobile: path.join(root, 'components', 'layout', 'MobileNavigation.tsx'),
  styles: path.join(root, 'app', 'ui-stabilization-contract.css'),
};

const [search, mobile, styles] = await Promise.all([
  readFile(files.search, 'utf8'),
  readFile(files.mobile, 'utf8'),
  readFile(files.styles, 'utf8'),
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
requireSource(mobile, /mobile-nav-panel/, 'The mobile navigation drawer contract is missing.');
requireSource(styles, /\.mobile-nav-panel[\s\S]*z-index:\s*(?:[2-9]\d{3,}|1\d{4,})/m, 'The mobile navigation drawer must have an explicit high stacking layer.');
requireSource(styles, /\.global-search-overlay[\s\S]*z-index:\s*(?:[2-9]\d{3,}|1\d{4,})/m, 'Global Search must render above the mobile shell.');
requireSource(styles, /\.mobile-nav-panel[\s\S]*overflow-y:\s*auto/m, 'The mobile navigation drawer must scroll independently.');

if (failures.length > 0) {
  for (const failure of failures) console.error(`Mobile interaction check failed: ${failure}`);
  process.exit(1);
}

console.log('Mobile interaction contract passed: navigation, search, role filtering, stacking and scrolling safeguards are present.');
