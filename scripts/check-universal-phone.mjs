import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const [responsive, application, hygiene] = await Promise.all([
  readFile(path.join(root, 'app', 'responsive-mobile-tablet.css'), 'utf8'),
  readFile(path.join(root, 'app', 'styles', 'application.css'), 'utf8'),
  readFile(path.join(root, 'components', 'layout', 'MobileBrowserHygiene.tsx'), 'utf8'),
]);

const failures = [];
function requireText(source, text, message) {
  if (!source.includes(text)) failures.push(message);
}

requireText(application, "@import '../responsive-mobile-tablet.css';", 'Unified responsive CSS must be registered.');
if (!application.trim().endsWith("@import '../responsive-mobile-tablet.css';")) {
  failures.push('Unified responsive CSS must remain the final application import.');
}

requireText(responsive, '@media (max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse)', 'Responsive CSS must cover phones and touch tablets.');
requireText(responsive, 'var(--ui-canvas', 'Responsive canvas must inherit the desktop palette.');
requireText(responsive, 'var(--ui-gold', 'Responsive accents must inherit the desktop palette.');
requireText(responsive, '.mobile-nav-portal-root', 'Responsive navigation must use the body portal layer.');
requireText(responsive, '.global-search-dialog', 'Responsive search sheet styles are required.');
requireText(responsive, 'overflow-x: auto !important', 'Data surfaces must provide contained horizontal scrolling.');
requireText(responsive, 'font-size: 16px !important', 'Form controls must prevent iOS input zoom.');
requireText(responsive, '.messaging-layout', 'Responsive messaging layout rules are required.');
requireText(responsive, '.mobile-quick-bar', 'Responsive bottom navigation rules are required.');
requireText(responsive, 'orientation: landscape', 'Landscape rules are required.');
requireText(responsive, 'env(safe-area-inset-bottom)', 'Safe-area handling is required.');
requireText(responsive, "html[data-mobile-route-surface='auth']", 'Authentication pages must have native-scroll responsive rules.');
requireText(responsive, 'min-height: 100svh !important', 'Authentication pages must use minimum viewport height instead of fixed-height shells.');
requireText(hygiene, "body.style.removeProperty('overflow')", 'Responsive route hygiene must clear stale overflow locks.');
requireText(hygiene, "window.addEventListener('pageshow'", 'Responsive route hygiene must recover from back-forward cache restores.');
requireText(hygiene, "dataset.responsiveSurface = 'mobile-tablet'", 'Responsive runtime state must identify mobile/tablet mode.');

if (failures.length) {
  failures.forEach((failure) => console.error(`Responsive coverage check failed: ${failure}`));
  process.exit(1);
}

console.log('Responsive coverage contract passed: phones, portrait tablets, landscape touch tablets, auth scrolling, desktop palette, navigation, search, forms, tables, messaging and safe areas are covered.');
