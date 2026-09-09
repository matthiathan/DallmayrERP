import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const styles = path.join(root, 'app', 'styles');
const manifest = await readFile(path.join(styles, 'legacy-feature-manifest.css'), 'utf8');

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
  "@import '../ux-polish.css'",
  "@import '../ultrawide.css'",
  "@import '../contrast-pairing.css'",
  "@import '../professional-nowrap-layout.css'",
];
for (const retiredImport of retiredImports) {
  if (manifest.includes(retiredImport)) {
    console.error(`Retired or consolidated legacy registration must not be reintroduced: ${retiredImport}`);
    process.exitCode = 1;
  }
}

for (const requiredActiveImport of [
  "@import './features/account-menu.css'",
  "@import './page-families/minimalist-operations.css'",
  "@import './features/density.css'",
  "@import './features/text-visibility-polish.css'",
  "@import './page-families/reliability-machine-search.css'",
  "@import './features/appearance-panel.css'",
  "@import './features/appearance-customization.css'",
  "@import './themes/slate-sand-themes.css'",
  "@import './active-mobile-workspaces.css'",
]) {
  if (!manifest.includes(requiredActiveImport)) {
    console.error(`Active feature/appearance owner must remain registered: ${requiredActiveImport}`);
    process.exitCode = 1;
  }
}

const activeMobileBundle = await readFile(path.join(styles, 'active-mobile-workspaces.css'), 'utf8');
if (/^\s*@import\s/m.test(activeMobileBundle)) {
  console.error('Legacy mobile workspace bundle must remain empty; the replacement shell belongs to the canonical responsive authorities.');
  process.exitCode = 1;
}

const readabilitySafety = await readFile(path.join(styles, 'canonical-readability-safety.css'), 'utf8');
for (const requiredRule of [
  'touch-action: manipulation',
  ':is(img, svg, canvas, video)',
  ":is(input, select, textarea)",
  "input[type='checkbox']",
  ":is(button, .button, a.button, [role='button'])",
  '.scanner-actions',
  '.table-sort-button',
  '.field-note.danger',
  '.record-timeline-item',
]) {
  if (!readabilitySafety.includes(requiredRule)) {
    console.error(`Canonical readability safety is missing migrated invariant: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const componentUtilities = await readFile(path.join(root, 'app', 'canonical-component-utilities.css'), 'utf8');
for (const requiredRule of ['.breadcrumbs', '.empty-state', '.status-timeline', '.scanner-match-card']) {
  if (!componentUtilities.includes(requiredRule)) {
    console.error(`Canonical component utilities are missing migrated UX structure: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const roleWorkspaceDetails = await readFile(path.join(styles, 'page-families', 'role-workspace-details.css'), 'utf8');
for (const requiredRule of ['.role-workspace-stage', '.role-action-grid', '.role-action-card']) {
  if (!roleWorkspaceDetails.includes(requiredRule)) {
    console.error(`Role workspace owner is missing migrated UX structure: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const reliabilitySearch = await readFile(path.join(styles, 'page-families', 'reliability-machine-search.css'), 'utf8');
for (const requiredRule of ['.machine-match-options', '.machine-match-list', '.machine-match-option']) {
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
  'monday-shell-phase-1',
  'mobile-navigation',
  'mobile-menu-open',
  'MobileNavigationDrawer',
  'MobileQuickBar',
  'menuOpen',
  'setMenuOpen',
]) {
  if (appShell.includes(obsoleteHook)) {
    console.error(`Current AppShell must not contain retired shell/mobile hook: ${obsoleteHook}`);
    process.exitCode = 1;
  }
}
if (!appShell.includes('MobileTelemetryShell')) {
  console.error('Current AppShell must mount the replacement MobileTelemetryShell boundary.');
  process.exitCode = 1;
}

try {
  await access(path.join(root, 'components', 'layout', 'MobileNavigation.tsx'));
  console.error('Legacy MobileNavigation.tsx must remain removed for the ground-up mobile rebuild.');
  process.exitCode = 1;
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const mobileTelemetryShell = await readFile(path.join(root, 'components', 'layout', 'MobileTelemetryShell.tsx'), 'utf8');
for (const requiredMobileContract of [
  'data-mobile-shell="v1"',
  'Primary mobile navigation',
  'telemetry-mobile-bottom-nav',
  'telemetry-mobile-menu',
  'mobile-account-menu-target',
  'navigationIconKind',
]) {
  if (!mobileTelemetryShell.includes(requiredMobileContract)) {
    console.error(`Replacement mobile shell is missing contract marker: ${requiredMobileContract}`);
    process.exitCode = 1;
  }
}
for (const retiredMobileHook of ['MobileNavigationDrawer', 'MobileQuickBar', 'mobile-nav-portal-root', 'mobile-quick-bar']) {
  if (mobileTelemetryShell.includes(retiredMobileHook)) {
    console.error(`Replacement mobile shell must not reuse retired mobile hook: ${retiredMobileHook}`);
    process.exitCode = 1;
  }
}

const desktopNavigation = await readFile(path.join(root, 'components', 'layout', 'DesktopNavigationRail.tsx'), 'utf8');
for (const forbiddenGlyph of ['‹', '›']) {
  if (desktopNavigation.includes(forbiddenGlyph)) {
    console.error(`Desktop navigation must use SVG icons instead of text glyph: ${forbiddenGlyph}`);
    process.exitCode = 1;
  }
}
if (!desktopNavigation.includes('NavigationIcon') || !desktopNavigation.includes('navigationIconKind')) {
  console.error('Desktop navigation must use the shared SVG navigation icon contract.');
  process.exitCode = 1;
}

const navigationIcons = await readFile(path.join(root, 'components', 'layout', 'NavigationIcon.tsx'), 'utf8');
for (const requiredRule of ['export function NavigationIcon', 'export function navigationIconKind']) {
  if (!navigationIcons.includes(requiredRule)) {
    console.error(`Shared SVG navigation icon set is missing ${requiredRule}.`);
    process.exitCode = 1;
  }
}

const application = await readFile(path.join(styles, 'application.css'), 'utf8');
for (const requiredManifest of [
  "@import './application/base.css'",
  "@import './application/desktop.css'",
  "@import './application/responsive.css'",
]) {
  if (!application.includes(requiredManifest)) {
    console.error(`Canonical application registry must retain ${requiredManifest}`);
    process.exitCode = 1;
  }
}

const baseAuthority = await readFile(path.join(styles, 'application', 'base.css'), 'utf8');
const desktopAuthority = await readFile(path.join(styles, 'application', 'desktop.css'), 'utf8');
const responsiveAuthority = await readFile(path.join(styles, 'application', 'responsive.css'), 'utf8');
for (const requiredBase of [
  "@import '../../canonical-component-utilities.css'",
  "@import '../../canonical-navigation-baseline.css'",
  "@import '../../canonical-appearance-runtime.css'",
]) {
  if (!baseAuthority.includes(requiredBase)) {
    console.error(`Base application authority must retain ${requiredBase}`);
    process.exitCode = 1;
  }
}
for (const requiredDesktop of [
  "@import '../../desktop-reference-layout.css'",
  "@import '../../professional-ui-system.css'",
  "@import '../../concentrix-dallmayr-shell.css'",
  "@import '../../concentrix-execution-details.css'",
]) {
  if (!desktopAuthority.includes(requiredDesktop)) {
    console.error(`Desktop application authority must retain ${requiredDesktop}`);
    process.exitCode = 1;
  }
}
for (const requiredResponsiveImport of [
  "@import '../../responsive-runtime-authority.css'",
  "@import '../../responsive-mobile-interactions.css'",
  "@import '../../professional-finish.css'",
  "@import '../../professional-finish-details.css'",
  "@import '../../compact-desktop-authority.css'",
  "@import '../connected-workflow-strip.css'",
  "@import '../../responsive-mobile-tablet.css'",
]) {
  if (!responsiveAuthority.includes(requiredResponsiveImport)) {
    console.error(`Responsive registry must retain cascade placeholder/import: ${requiredResponsiveImport}`);
    process.exitCode = 1;
  }
}

const appearanceRuntime = await readFile(path.join(root, 'app', 'canonical-appearance-runtime.css'), 'utf8');
for (const requiredRule of [
  'html[data-visual-theme]',
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
for (const requiredRule of ['.erp-panel', '.erp-table-shell', '.erp-toolbar', '.status-badge', ':focus-visible', '.dallmayr-sidebar-link svg']) {
  if (!professionalUi.includes(requiredRule)) {
    console.error(`Canonical professional UI is missing predecessor replacement rule: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const navigationBaseline = await readFile(path.join(root, 'app', 'canonical-navigation-baseline.css'), 'utf8');
for (const requiredRule of ['.skip-link', '.skip-link:focus', '@media (prefers-reduced-motion: reduce)']) {
  if (!navigationBaseline.includes(requiredRule)) {
    console.error(`Canonical navigation baseline is missing desktop/accessibility rule: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const foundations = await readFile(path.join(styles, 'foundations.css'), 'utf8');
for (const requiredRule of [':focus-visible', '@media (prefers-reduced-motion: reduce)', '@media print', '.application-header', '.dallmayr-sidebar']) {
  if (!foundations.includes(requiredRule)) {
    console.error(`Shared foundations are missing retired-shell replacement rule: ${requiredRule}`);
    process.exitCode = 1;
  }
}

const responsiveRuntime = await readFile(path.join(root, 'app', 'responsive-runtime-authority.css'), 'utf8');
for (const requiredRule of [
  '.telemetry-mobile-shell',
  '.telemetry-mobile-header',
  '.telemetry-mobile-bottom-nav',
  '.application-header,',
  '.dallmayr-sidebar',
  '@media (max-width: 900px)',
]) {
  if (!responsiveRuntime.includes(requiredRule)) {
    console.error(`Replacement mobile runtime authority is missing ${requiredRule}.`);
    process.exitCode = 1;
  }
}

const responsiveInteractions = await readFile(path.join(root, 'app', 'responsive-mobile-interactions.css'), 'utf8');
for (const requiredRule of [
  '.telemetry-mobile-menu-layer',
  '.telemetry-mobile-menu-backdrop',
  '.telemetry-mobile-menu-panel',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!responsiveInteractions.includes(requiredRule)) {
    console.error(`Replacement mobile interaction authority is missing ${requiredRule}.`);
    process.exitCode = 1;
  }
}

const reservedTabletAuthority = await readFile(path.join(root, 'app', 'responsive-mobile-tablet.css'), 'utf8');
const reservedTabletWithoutComments = reservedTabletAuthority.replace(/\/\*[\s\S]*?\*\//g, '').trim();
if (reservedTabletWithoutComments.length > 0) {
  console.error('app/responsive-mobile-tablet.css must remain reserved until page-family/tablet adaptation begins.');
  process.exitCode = 1;
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Style guard passed: desktop authorities remain intact and the new telemetry mobile shell owns the canonical responsive runtime without restoring legacy mobile layers.');
