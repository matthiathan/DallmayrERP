import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const [responsive, authority, application, responsiveManifest, hygiene] = await Promise.all([
  readFile(path.join(root, 'app', 'responsive-mobile-tablet.css'), 'utf8'),
  readFile(path.join(root, 'app', 'responsive-runtime-authority.css'), 'utf8'),
  readFile(path.join(root, 'app', 'styles', 'application.css'), 'utf8'),
  readFile(path.join(root, 'app', 'styles', 'application', 'responsive.css'), 'utf8'),
  readFile(path.join(root, 'components', 'layout', 'MobileBrowserHygiene.tsx'), 'utf8'),
]);

const failures = [];
function requireText(source, text, message) {
  if (!source.includes(text)) failures.push(message);
}

requireText(application, "@import './application/responsive.css';", 'Application registry must delegate responsive ownership to the responsive manifest.');
requireText(responsiveManifest, "@import '../../responsive-mobile-tablet.css';", 'Unified responsive CSS must be registered by the responsive authority.');
if (!responsiveManifest.trim().endsWith("@import '../../responsive-mobile-tablet.css';")) {
  failures.push('Unified responsive CSS must remain the final responsive authority import.');
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

requireText(authority, "html[data-responsive-surface='mobile-tablet'] body .application-header", 'Responsive header must have high-specificity palette authority.');
requireText(authority, 'background-color: var(--ui-surface-soft', 'Responsive chrome must use the desktop surface palette.');
requireText(authority, "html[data-responsive-surface='mobile-tablet'] body .mobile-quick-bar", 'Responsive bottom navigation must have palette authority.');
requireText(authority, '@media (max-width: 480px)', 'Narrow-phone dashboard density rules are required.');
requireText(authority, 'grid-template-columns: minmax(0, 1fr) !important', 'Narrow-phone KPI grids must collapse to one column.');
requireText(authority, 'border-left-color: var(--ui-gold', 'Responsive KPI accents must use the Dallmayr desktop gold token.');
requireText(authority, 'overflow-x: hidden !important', 'Responsive shell must prevent page-level horizontal overflow.');

requireText(hygiene, "body.style.removeProperty('overflow')", 'Responsive route hygiene must clear stale overflow locks.');
requireText(hygiene, "window.addEventListener('pageshow'", 'Responsive route hygiene must recover from back-forward cache restores.');
requireText(hygiene, "dataset.responsiveSurface = 'mobile-tablet'", 'Responsive runtime state must identify mobile/tablet mode.');

if (failures.length) {
  failures.forEach((failure) => console.error(`Responsive coverage check failed: ${failure}`));
  process.exit(1);
}

console.log('Responsive coverage contract passed: phones, tablets, native scrolling, desktop palette authority, narrow-phone dashboard density, navigation, search, forms, tables, messaging and safe areas are covered through the explicit responsive authority.');
