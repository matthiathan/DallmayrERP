import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const css = await readFile(path.join(root, 'app', 'mobile-universal-phone.css'), 'utf8');
const application = await readFile(path.join(root, 'app', 'styles', 'application.css'), 'utf8');
const workflow = await readFile(path.join(root, 'components', 'ui', 'MobileWorkflowEnhancer.tsx'), 'utf8');

const failures = [];
function requireText(source, text, message) {
  if (!source.includes(text)) failures.push(message);
}

const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
if (!noComments.startsWith('@media (max-width: 900px) {')) {
  failures.push('Universal phone CSS must be entirely scoped to max-width: 900px.');
}

requireText(application, "@import '../mobile-universal-phone.css';", 'Universal phone CSS must be registered as the final application layer.');
if (!application.trim().endsWith("@import '../mobile-universal-phone.css';")) {
  failures.push('Universal phone CSS must remain the final application import.');
}
requireText(workflow, "const MOBILE_QUERY = '(max-width: 900px)'", 'Mobile workflow behavior must match the 900px universal phone breakpoint.');
requireText(css, '--phone-canvas: #f5f0e6', 'Phone canvas must match the desktop Dallmayr palette.');
requireText(css, '--phone-gold: #b8862f', 'Phone gold must match the desktop Dallmayr palette.');
requireText(css, '.mobile-nav-portal-root', 'Phone navigation must use the body portal layer.');
requireText(css, '.global-search-dialog', 'Phone search sheet styles are required.');
requireText(css, 'overflow-x: auto !important', 'Phone data surfaces must provide contained horizontal scrolling.');
requireText(css, 'font-size: 16px !important', 'Phone form controls must prevent iOS input zoom.');
requireText(css, '.messaging-layout', 'Phone messaging layout rules are required.');
requireText(css, '.mobile-quick-bar', 'Phone bottom navigation rules are required.');
requireText(css, '@media (max-height: 500px) and (orientation: landscape)', 'Landscape phone rules are required.');
requireText(css, 'env(safe-area-inset-bottom)', 'Phone safe-area handling is required.');

if (failures.length) {
  failures.forEach((failure) => console.error(`Universal phone check failed: ${failure}`));
  process.exit(1);
}

console.log('Universal phone contract passed: 320-900px mobile mode, desktop palette, navigation, search, forms, tables, messaging, landscape and safe-area safeguards are present.');
