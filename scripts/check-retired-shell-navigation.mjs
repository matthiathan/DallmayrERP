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
  "@import '../minimalist-ui-polish.css'",
  "@import '../professional-layout-system.css'",
  "@import '../user-first-layout.css'",
  "@import '../adaptive-contrast.css'",
  "@import '../rendered-surface-contrast.css'",
];

for (const retiredImport of retiredImports) {
  if (manifest.includes(retiredImport)) {
    console.error(`Retired or consolidated legacy registration must not be reintroduced: ${retiredImport}`);
    process.exitCode = 1;
  }
}

for (const requiredActiveImport of [
  "@import '../account-menu.css'",
  "@import '../minimalist-operations.css'",
  "@import '../ux-polish.css'",
  "@import '../reliability-machine-search.css'",
  "@import '../appearance-panel.css'",
  "@import '../appearance-customization.css'",
  "@import '../slate-sand-themes.css'",
  "@import './active-mobile-workspaces.css'",
]) {
  if (!manifest.includes(requiredActiveImport)) {
    console.error(`Active feature/appearance owner must remain registered: ${requiredActiveImport}`);
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
  ":is(input, select, textarea)",
  "input[type='checkbox']",
  ":is(button, .button, a.button, [role='button'])",
  '.scanner-actions',
  '.table-sort-button',
]) {
  if (!readabilitySafety.includes(requiredRule)) {
    console.error(`Canonical readability safety is missing migrated invariant: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const reliabilitySearch = await readFile(path.join(root, 'app', 'reliability-machine-search.css'), 'utf8');
for (const requiredRule of [
  '.machine-match-options',
  '.machine-match-list',
  '.machine-match-option',
]) {
  if (!reliabilitySearch.includes(requiredRule)) {
    console.error(`Reliability machine-search owner is missing migrated compatibility rule: ${requiredRule}`);
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
for (const requiredCanonicalImport of [
  "@import '../canonical-navigation-baseline.css'",
  "@import '../professional-ui-system.css'",
  "@import '../concentrix-dallmayr-shell.css'",
  "@import '../concentrix-execution-details.css'",
  "@import '../canonical-appearance-runtime.css'",
  "@import '../responsive-mobile-tablet.css'",
]) {
  if (!applicationManifest.includes(requiredCanonicalImport)) {
    console.error(`Canonical application manifest must retain ${requiredCanonicalImport}`);
    process.exitCode = 1;
  }
}

const appearanceRuntimeIndex = applicationManifest.indexOf("@import '../canonical-appearance-runtime.css'");
const responsiveRuntimeIndex = applicationManifest.indexOf("@import '../responsive-runtime-authority.css'");
if (appearanceRuntimeIndex < 0 || responsiveRuntimeIndex < 0 || appearanceRuntimeIndex >= responsiveRuntimeIndex) {
  console.error('Canonical appearance runtime must load immediately before the responsive authority group.');
  process.exitCode = 1;
}

const appearanceRuntime = await readFile(path.join(root, 'app', 'canonical-appearance-runtime.css'), 'utf8');
for (const requiredRule of [
  "html[data-visual-theme]",
  '--appearance-runtime-accent: var(--user-accent',
  '--appearance-content-surface: var(--content-surface',
  '--user-accent: var(--appearance-runtime-accent',
  '--content-surface: var(--appearance-content-surface',
  '--design-accent: var(--appearance-runtime-accent',
  '--adaptive-text: var(--appearance-content-text',
  "html[data-theme-tone='dark']",
  "html[data-theme-tone='light']",
]) {
  if (!appearanceRuntime.includes(requiredRule)) {
    console.error(`Canonical appearance runtime is missing persisted/runtime bridge rule: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const professionalUi = await readFile(path.join(root, 'app', 'professional-ui-system.css'), 'utf8');
for (const requiredRule of [
  '.erp-panel',
  '.erp-table-shell',
  '.erp-toolbar',
  '.status-badge',
  ':focus-visible',
  '.dallmayr-sidebar-link svg',
]) {
  if (!professionalUi.includes(requiredRule)) {
    console.error(`Canonical professional UI is missing predecessor replacement rule: ${requiredRule}`);
    process.exitCode = 1;
  }
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
console.log('Retired shell/navigation/mobile/generic-visual/contrast guard passed: obsolete programmes remain unregistered, active structural/curated appearance/mobile feature styles remain owned, runtime appearance values bridge into the curated theme without shadowing, and current professional/navigation/responsive layers are present.');
