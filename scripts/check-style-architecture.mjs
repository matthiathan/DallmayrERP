import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const stylesDirectory = path.join(root, 'app', 'styles');
const layoutPath = path.join(root, 'app', 'layout.tsx');
const entryPath = path.join(stylesDirectory, 'index.css');
const applicationPath = path.join(stylesDirectory, 'application.css');

function fail(message) {
  console.error(`Style architecture check failed: ${message}`);
  process.exitCode = 1;
}

function cssImports(source) {
  return [...source.matchAll(/@import\s+['"]([^'"]+\.css)['"];?/g)].map((match) => match[1]);
}

function repoPath(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

const layout = await readFile(layoutPath, 'utf8');
const layoutCssImports = [...layout.matchAll(/import\s+['"]([^'"]+\.css)['"];?/g)].map((match) => match[1]);
if (layoutCssImports.length !== 1 || layoutCssImports[0] !== './styles/index.css') {
  fail(`app/layout.tsx must import only ./styles/index.css; found ${JSON.stringify(layoutCssImports)}.`);
}

const expectedEntryImports = [
  './tokens.css',
  './legacy-feature-manifest.css',
  './foundations.css',
  './legacy-layout-manifest.css',
  './application.css',
];
const entry = await readFile(entryPath, 'utf8');
const entryImports = cssImports(entry);
if (JSON.stringify(entryImports) !== JSON.stringify(expectedEntryImports)) {
  fail(`app/styles/index.css must contain the canonical ordered imports ${JSON.stringify(expectedEntryImports)}; found ${JSON.stringify(entryImports)}.`);
}

const visited = new Set();
const activeStack = new Set();
async function validateStylesheet(filePath) {
  const normalized = path.normalize(filePath);
  if (activeStack.has(normalized)) {
    fail(`Stylesheet import cycle detected at ${repoPath(normalized)}.`);
    return;
  }
  if (visited.has(normalized)) return;
  activeStack.add(normalized);
  visited.add(normalized);

  let source;
  try {
    await access(normalized);
    source = await readFile(normalized, 'utf8');
  } catch {
    fail(`Stylesheet ${repoPath(normalized)} does not exist or cannot be read.`);
    activeStack.delete(normalized);
    return;
  }

  if (/-final\.css$/i.test(normalized)) fail(`Compatibility stylesheet ${repoPath(normalized)} must not use the retired *-final.css naming pattern.`);
  const imports = cssImports(source);
  if (new Set(imports).size !== imports.length) fail(`${repoPath(normalized)} contains duplicate imports.`);
  for (const importPath of imports) await validateStylesheet(path.resolve(path.dirname(normalized), importPath));
  activeStack.delete(normalized);
}
await validateStylesheet(entryPath);

for (const manifestPath of [
  path.join(stylesDirectory, 'legacy-feature-manifest.css'),
  path.join(stylesDirectory, 'legacy-layout-manifest.css'),
]) {
  const source = await readFile(manifestPath, 'utf8');
  if (!source.includes('Do not add new')) fail(`${repoPath(manifestPath)} must retain its quarantine/ownership guidance.`);
}

const legacyLayoutSource = await readFile(path.join(stylesDirectory, 'legacy-layout-manifest.css'), 'utf8');
for (const retiredLayout of [
  "@import '../monday-shell-phase-1.css'",
  "@import '../application-shell-phase-1.css'",
  "@import '../page-templates-phase-2.css'",
  "@import '../operations-cockpit.css'",
  "@import '../erp-executive-ui.css'",
  "@import '../dynamics-365-ui.css'",
  "@import '../erp-workbench-system.css'",
  "@import '../ui-readability-layout.css'",
  "@import './navigation-contract.css'",
  "@import './compatibility-overrides.css'",
]) {
  if (legacyLayoutSource.includes(retiredLayout)) fail(`Retired layout programme ${retiredLayout} must not be registered in legacy-layout-manifest.css.`);
}

const expectedActiveLayoutImports = [
  './active-role-today-workspace.css',
  './active-board-workspaces.css',
  './canonical-readability-safety.css',
  './active-messaging-workspace.css',
];
const legacyLayoutImports = cssImports(legacyLayoutSource);
if (JSON.stringify(legacyLayoutImports) !== JSON.stringify(expectedActiveLayoutImports)) {
  fail(`legacy-layout-manifest.css must contain only the active feature/safety boundaries ${JSON.stringify(expectedActiveLayoutImports)}; found ${JSON.stringify(legacyLayoutImports)}.`);
}

const expectedApplicationManifests = [
  './application/base.css',
  './application/desktop.css',
  './application/responsive.css',
];
const applicationSource = await readFile(applicationPath, 'utf8');
const applicationImports = cssImports(applicationSource);
if (JSON.stringify(applicationImports) !== JSON.stringify(expectedApplicationManifests)) {
  fail(`app/styles/application.css must contain only the ordered application authorities ${JSON.stringify(expectedApplicationManifests)}; found ${JSON.stringify(applicationImports)}.`);
}

const expectedApplicationLeaves = [
  'app/full-application-rebuild.css',
  'app/route-composition-system.css',
  'app/dashboard-role-workspace-rebuild.css',
  'app/final-route-family-rebuild.css',
  'app/navigation-contrast-phase-1.css',
  'app/page-cleanup-phase-4.css',
  'app/component-library-phase-3.css',
  'app/canonical-component-utilities.css',
  'app/canonical-dialog.css',
  'app/ui-stabilization-contract.css',
  'app/canonical-navigation-baseline.css',
  'app/canonical-appearance-runtime.css',
  'app/desktop-reference-layout.css',
  'app/desktop-layout-regression-fixes.css',
  'app/professional-ui-system.css',
  'app/concentrix-dallmayr-shell.css',
  'app/concentrix-dallmayr-dashboard.css',
  'app/concentrix-operational-pages.css',
  'app/concentrix-specialist-workspaces.css',
  'app/concentrix-access-entry.css',
  'app/concentrix-execution-details.css',
  'app/concentrix-final-audit.css',
  'app/canonical-shell-utilities.css',
  'app/responsive-runtime-authority.css',
  'app/responsive-mobile-interactions.css',
  'app/professional-finish.css',
  'app/professional-finish-details.css',
  'app/compact-desktop-authority.css',
  'app/styles/connected-workflow-strip.css',
  'app/responsive-mobile-tablet.css',
];
const applicationLeaves = [];
for (const manifestImport of expectedApplicationManifests) {
  const manifestPath = path.resolve(path.dirname(applicationPath), manifestImport);
  const manifestSource = await readFile(manifestPath, 'utf8');
  for (const leafImport of cssImports(manifestSource)) {
    applicationLeaves.push(repoPath(path.resolve(path.dirname(manifestPath), leafImport)));
  }
}
if (JSON.stringify(applicationLeaves) !== JSON.stringify(expectedApplicationLeaves)) {
  fail(`Application authority manifests must preserve the approved flattened cascade ${JSON.stringify(expectedApplicationLeaves)}; found ${JSON.stringify(applicationLeaves)}.`);
}
if (applicationLeaves.at(-1) !== 'app/responsive-mobile-tablet.css') {
  fail(`The unified responsive contract must remain the final application leaf; found ${applicationLeaves.at(-1)}.`);
}
for (const retiredLeaf of [
  'app/mobile-functional-experience.css',
  'app/mobile-menu-stacking-fix.css',
  'app/mobile-overhaul.css',
  'app/mobile-universal-phone.css',
  'app/mobile-browser-native.css',
]) {
  if (applicationLeaves.includes(retiredLeaf)) fail(`Retired responsive layer ${retiredLeaf} must not be registered.`);
}

const tokenSource = await readFile(path.join(stylesDirectory, 'tokens.css'), 'utf8');
for (const requiredAlias of ['--monday-shell-bg:', '--monday-divider:', '--monday-accent:']) {
  if (!tokenSource.includes(requiredAlias)) fail(`Design-system tokens are missing legacy board compatibility alias ${requiredAlias}.`);
}

const foundationsSource = await readFile(path.join(stylesDirectory, 'foundations.css'), 'utf8');
for (const requiredRule of [
  '.workspace-template-frame',
  'align-content: start',
  '.workspace-command-controls > summary',
  '@media (max-width: 760px)',
  ':focus-visible',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!foundationsSource.includes(requiredRule)) fail(`Shared foundations are missing ${requiredRule}.`);
}

const readabilitySafetySource = await readFile(path.join(stylesDirectory, 'canonical-readability-safety.css'), 'utf8');
for (const requiredRule of [
  '--mobile-quick-bar-height:',
  '[role=\'alert\'].danger *',
  '.appearance-save-state.is-saved',
  '.appearance-save-state.is-error',
  '.global-search-result',
  'scrollbar-gutter: stable both-edges',
]) {
  if (!readabilitySafetySource.includes(requiredRule)) fail(`Canonical readability/semantic safety is missing ${requiredRule}.`);
}
if (readabilitySafetySource.includes('--ui-safe-blue')) fail('Canonical readability safety must not restore the retired blue visual programme.');

const mobileDataViewsSource = await readFile(path.join(root, 'app', 'mobile-data-views.css'), 'utf8');
for (const requiredRule of [
  '.mobile-record-card-details > div:has(.button)',
  '.low-stock-alerts > .grid',
  '.document-grid',
  'var(--mobile-quick-bar-height, 0px)',
]) {
  if (!mobileDataViewsSource.includes(requiredRule)) fail(`Mobile data views are missing migrated compatibility rule ${requiredRule}.`);
}

const mobileOfflineSource = await readFile(path.join(root, 'app', 'mobile-offline-field-work.css'), 'utf8');
for (const requiredRule of [
  'var(--mobile-quick-bar-height, 66px)',
  '@media (max-width: 390px)',
  '.field-offline-indicator strong',
]) {
  if (!mobileOfflineSource.includes(requiredRule)) fail(`Offline field-work presentation is missing migrated navigation compatibility rule ${requiredRule}.`);
}

const stabilizationSource = await readFile(path.join(root, 'app', 'ui-stabilization-contract.css'), 'utf8');
for (const requiredRule of ['--ui-canvas: #f5f0e6', '--ui-ink: #231f1a', '--ui-gold: #b8862f', '.dallmayr-sidebar']) {
  if (!stabilizationSource.includes(requiredRule)) fail(`Desktop stabilization is missing ${requiredRule}.`);
}

const professionalUiSource = await readFile(path.join(root, 'app', 'professional-ui-system.css'), 'utf8');
for (const requiredRule of ['--pro-radius-md: 12px', '.erp-panel', '.erp-table-shell', '.erp-toolbar', '.status-badge', ':focus-visible', '.dallmayr-sidebar-link svg']) {
  if (!professionalUiSource.includes(requiredRule)) fail(`Professional UI system is missing ${requiredRule}.`);
}

const concentrixShellSource = await readFile(path.join(root, 'app', 'concentrix-dallmayr-shell.css'), 'utf8');
for (const requiredRule of [
  '--cx-sidebar: 264px',
  '--cx-header: 88px',
  '--application-header-height: var(--cx-header)',
  '.application-shell-v2',
  'padding-left: var(--cx-sidebar) !important',
  '.dallmayr-sidebar',
  'width: min(100%, 1600px)',
  'box-shadow: inset 3px 0 0 var(--cx-gold)',
]) {
  if (!concentrixShellSource.includes(requiredRule)) fail(`Concentrix-derived shell is missing ${requiredRule}.`);
}

const concentrixDashboardSource = await readFile(path.join(root, 'app', 'concentrix-dallmayr-dashboard.css'), 'utf8');
for (const requiredRule of ['.cx-dashboard-hero', '.cx-dashboard-kpis', 'grid-template-columns: repeat(6, minmax(0, 1fr))', '.cx-dashboard-reporting']) {
  if (!concentrixDashboardSource.includes(requiredRule)) fail(`Concentrix-derived dashboard is missing ${requiredRule}.`);
}

const concentrixOperationalSource = await readFile(path.join(root, 'app', 'concentrix-operational-pages.css'), 'utf8');
for (const requiredRule of ['@media (min-width: 901px)', '.workspace-template-frame:is(.template-list, .template-record, .template-operational, .template-form)', '--cx-op-control-height: 42px', 'overflow-x: clip', '@media (max-width: 1180px)']) {
  if (!concentrixOperationalSource.includes(requiredRule)) fail(`Concentrix-derived operational pages are missing ${requiredRule}.`);
}

const concentrixSpecialistSource = await readFile(path.join(root, 'app', 'concentrix-specialist-workspaces.css'), 'utf8');
for (const requiredRule of ['@media (min-width: 901px)', '--cx-specialist-control-height: 42px', '.admin-access-stage', '.messages-v2-shell', '.global-search-dialog', '.appearance-editor', '.spatial-dashboard', '@media (min-width: 901px) and (max-width: 1180px)']) {
  if (!concentrixSpecialistSource.includes(requiredRule)) fail(`Concentrix-derived specialist workspaces are missing ${requiredRule}.`);
}

const concentrixAccessSource = await readFile(path.join(root, 'app', 'concentrix-access-entry.css'), 'utf8');
for (const requiredRule of [
  '@media (min-width: 901px) and (hover: hover) and (pointer: fine), (min-width: 1367px)',
  '--cx-access-control-height: 46px',
  '.dynamics-login-page',
  '.dynamics-login-intro',
  '.dynamics-login-card',
  '.login-remember-me',
  '.auth-state-page',
  '.concentrix-onboarding-stage',
  '@media (min-width: 901px) and (max-width: 1180px) and (hover: hover) and (pointer: fine)',
]) {
  if (!concentrixAccessSource.includes(requiredRule)) fail(`Concentrix-derived access-entry surfaces are missing ${requiredRule}.`);
}
if (concentrixAccessSource.includes('pointer: coarse')) fail('Concentrix access-entry phase must not define a coarse-pointer responsive authority.');

const concentrixExecutionSource = await readFile(path.join(root, 'app', 'concentrix-execution-details.css'), 'utf8');
for (const requiredRule of [
  '@media (min-width: 901px) and (hover: hover) and (pointer: fine), (min-width: 1367px)',
  '--cx-execution-control-height: 42px',
  '.field-service-workspace',
  '.minimal-panel',
  '.status-timeline',
  '.live-scanner-box',
  '.scanner-match-card',
  '.asset-ticket',
  '.enterprise-table-shell',
  '@media (min-width: 901px) and (max-width: 1180px) and (hover: hover) and (pointer: fine)',
]) {
  if (!concentrixExecutionSource.includes(requiredRule)) fail(`Concentrix-derived execution-detail surfaces are missing ${requiredRule}.`);
}
if (concentrixExecutionSource.includes('pointer: coarse')) fail('Concentrix execution-detail phase must not define a coarse-pointer responsive authority.');

const concentrixFinalAuditSource = await readFile(path.join(root, 'app', 'concentrix-final-audit.css'), 'utf8');
for (const requiredRule of [
  '@media (min-width: 901px) and (hover: hover) and (pointer: fine), (min-width: 1367px)',
  '--cx-final-control-height: 42px',
  '--monday-accent: var(--cx-final-gold)',
  '--d365-blue: var(--cx-final-gold)',
  '--erp-workbench-blue: var(--cx-final-gold)',
  '.today-workspace-stage',
  '.monday-board-header',
  '.monday-board-surface',
  '.monday-item-card',
  '.monday-my-work',
  '.monday-service-operations',
  '@media (min-width: 901px) and (max-width: 1180px) and (hover: hover) and (pointer: fine)',
]) {
  if (!concentrixFinalAuditSource.includes(requiredRule)) fail(`Concentrix final-audit layer is missing ${requiredRule}.`);
}
if (concentrixFinalAuditSource.includes('pointer: coarse')) fail('Concentrix final-audit phase must not define a coarse-pointer responsive authority.');
if (concentrixFinalAuditSource.includes('display: none')) fail('Concentrix final-audit phase must not hide existing functionality.');

const shellUtilitiesSource = await readFile(path.join(root, 'app', 'canonical-shell-utilities.css'), 'utf8');
for (const requiredRule of [
  '--shell-util-surface:',
  '.notification-inbox-trigger',
  '.notification-inbox-panel',
  '.notification-card',
  '.mobile-primary-actions',
  '@media (max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse)',
  'env(safe-area-inset-bottom, 0px)',
]) {
  if (!shellUtilitiesSource.includes(requiredRule)) fail(`Canonical shell utilities are missing ${requiredRule}.`);
}
if (shellUtilitiesSource.includes('var(--monday-')) fail('Canonical shell utilities must not depend on retired Monday theme variables.');

const onboardingSource = await readFile(path.join(root, 'app', 'onboarding', 'page.tsx'), 'utf8');
if (!onboardingSource.includes('className="concentrix-onboarding-stage"')) fail('Onboarding must retain the Phase 5 presentation hook.');

const desktopRailSource = await readFile(path.join(root, 'components', 'layout', 'DesktopNavigationRail.tsx'), 'utf8');
if (desktopRailSource.includes('id="desktop-account-menu-target"')) fail('DesktopNavigationRail must not duplicate the header desktop-account-menu-target id.');
if (!desktopRailSource.includes('dallmayr-sidebar-account-menu-target')) fail('DesktopNavigationRail must retain the sidebar account-menu mount class.');
if (!desktopRailSource.includes('NavigationIcon') || !desktopRailSource.includes('navigationIconKind')) fail('DesktopNavigationRail must use the shared SVG navigation icon contract.');
if (desktopRailSource.includes('navigationGlyph(') || desktopRailSource.includes('function NavIcon')) fail('DesktopNavigationRail must not regress to generated or local legacy navigation icons.');

const navigationIconSource = await readFile(path.join(root, 'components', 'layout', 'NavigationIcon.tsx'), 'utf8');
if (!navigationIconSource.includes('export function NavigationIcon') || !navigationIconSource.includes('<svg')) fail('Shared NavigationIcon must provide SVG navigation icons.');

const responsiveSource = await readFile(path.join(root, 'app', 'responsive-mobile-tablet.css'), 'utf8');
const responsiveWithoutComments = responsiveSource.replace(/\/\*[\s\S]*?\*\//g, '').trim();
if (!responsiveWithoutComments.startsWith('@media (max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse) {')) {
  fail('responsive-mobile-tablet.css must begin with the locked phone/touch-tablet responsive query.');
}
for (const requiredRule of [
  'var(--ui-canvas',
  '.app-shell > .mobile-nav-backdrop',
  '.mobile-nav-portal-root',
  '.global-search-dialog',
  '.mobile-quick-bar',
  '.messaging-layout',
  "html[data-mobile-route-surface='auth'] .dynamics-login-page",
  "html[data-mobile-route-surface='auth'] .dynamics-login-card",
  "html[data-mobile-route-surface='auth'] .dynamics-login-intro",
  'overflow-x: auto !important',
  'font-size: 16px !important',
  'env(safe-area-inset-bottom)',
]) {
  if (!responsiveSource.includes(requiredRule)) fail(`Unified responsive contract is missing ${requiredRule}.`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`Style architecture check passed: ${visited.size} stylesheets registered, application cascade grouped into base/desktop/responsive authorities with exact leaf order preserved, retired compatibility programmes excluded, and final mobile/tablet ownership enforced.`);
