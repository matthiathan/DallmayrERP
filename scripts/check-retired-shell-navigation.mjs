import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifestPath = path.join(root, 'app', 'styles', 'legacy-feature-manifest.css');
const manifest = await readFile(manifestPath, 'utf8');

const retiredImports = [
  "@import '../navigation.css'",
  "@import '../erp-classic-navigation.css'",
  "@import '../notch-nav-fixes.css'",
  "@import '../ribbon-background.css'",
  "@import '../account-menu-brand-placement.css'",
  "@import '../dark-bezel-navigation.css'",
  "@import '../fixed-top-navigation.css'",
  "@import '../desktop-nav-overflow.css'",
  "@import '../user-first-application-shell.css'",
  "@import '../mobile.css'",
  "@import '../mobile-navigation-drawer.css'",
  "@import '../mobile-data-views.css'",
  "@import '../mobile-application-layout.css'",
  "@import '../mobile-master-detail-actions.css'",
  "@import '../mobile-offline-field-work.css'",
];

for (const retiredImport of retiredImports) {
  if (manifest.includes(retiredImport)) {
    console.error(`Retired or consolidated legacy registration must not be reintroduced: ${retiredImport}`);
    process.exitCode = 1;
  }
}

for (const requiredActiveImport of [
  "@import '../account-menu.css'",
  "@import './active-mobile-workspaces.css'",
]) {
  if (!manifest.includes(requiredActiveImport)) {
    console.error(`Active navigation/account/mobile owner must remain registered: ${requiredActiveImport}`);
    process.exitCode = 1;
  }
}

const activeMobileBundle = await readFile(path.join(root, 'app', 'styles', 'active-mobile-workspaces.css'), 'utf8');
const expectedMobileImports = [
  "@import '../mobile-navigation-drawer.css'",
  "@import '../mobile-data-views.css'",
  "@import '../mobile-application-layout.css'",
  "@import '../mobile-master-detail-actions.css'",
  "@import '../mobile-offline-field-work.css'",
];
let previousMobileImportIndex = -1;
for (const activeImport of expectedMobileImports) {
  const importIndex = activeMobileBundle.indexOf(activeImport);
  if (importIndex < 0) {
    console.error(`Active mobile workspace bundle is missing ${activeImport}`);
    process.exitCode = 1;
    continue;
  }
  if (importIndex <= previousMobileImportIndex) {
    console.error(`Active mobile workspace bundle must preserve import order; ${activeImport} is out of order.`);
    process.exitCode = 1;
  }
  previousMobileImportIndex = importIndex;
}

const readabilitySafety = await readFile(path.join(root, 'app', 'styles', 'canonical-readability-safety.css'), 'utf8');
for (const requiredRule of [
  'touch-action: manipulation',
  ':is(img, svg, canvas, video)',
]) {
  if (!readabilitySafety.includes(requiredRule)) {
    console.error(`Canonical readability safety is missing migrated mobile invariant: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const appShell = await readFile(path.join(root, 'components', 'layout', 'AppShell.tsx'), 'utf8');
for (const obsoleteHook of [
  'erp-chrome',
  'notch-navbar-frame',
  'notch-menu-row',
  'erp-menu-overflow',
  'ribbon-app-background',
]) {
  if (appShell.includes(obsoleteHook)) {
    console.error(`Current AppShell must not regress to retired shell hook: ${obsoleteHook}`);
    process.exitCode = 1;
  }
}

const applicationManifest = await readFile(path.join(root, 'app', 'styles', 'application.css'), 'utf8');
if (!applicationManifest.includes("@import '../canonical-navigation-baseline.css'")) {
  console.error('Canonical application manifest must register canonical-navigation-baseline.css.');
  process.exitCode = 1;
}

const navigationBaseline = await readFile(path.join(root, 'app', 'canonical-navigation-baseline.css'), 'utf8');
for (const requiredRule of [
  '.skip-link',
  '.skip-link:focus',
  '.application-mobile-menu-button',
  '.hamburger-button.notch-mobile-button',
  '.mobile-menu-open',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!navigationBaseline.includes(requiredRule)) {
    console.error(`Canonical navigation baseline is missing migrated rule: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const foundations = await readFile(path.join(root, 'app', 'styles', 'foundations.css'), 'utf8');
for (const requiredRule of [
  ':focus-visible',
  '@media (prefers-reduced-motion: reduce)',
  '@media print',
  '.application-header',
  '.dallmayr-sidebar',
]) {
  if (!foundations.includes(requiredRule)) {
    console.error(`Shared foundations are missing retired-shell replacement rule: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const responsive = await readFile(path.join(root, 'app', 'responsive-mobile-tablet.css'), 'utf8');
for (const requiredRule of [
  '.application-header',
  '.mobile-nav-portal-root',
  '.mobile-quick-bar',
  '.application-mobile-menu-button',
]) {
  if (!responsive.includes(requiredRule)) {
    console.error(`Responsive authority is missing retired-shell replacement rule: ${requiredRule}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Retired shell/navigation/mobile guard passed: obsolete top/notch/bezel/general-mobile programmes remain unregistered, active mobile feature styles are bundled in stable order, and canonical safety/navigation owners are present.');
