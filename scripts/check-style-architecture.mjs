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
    fail(`Stylesheet import cycle detected at ${path.relative(root, normalized)}.`);
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
    fail(`Stylesheet ${path.relative(root, normalized)} does not exist or cannot be read.`);
    activeStack.delete(normalized);
    return;
  }

  const imports = cssImports(source);
  if (new Set(imports).size !== imports.length) fail(`${path.relative(root, normalized)} contains duplicate imports.`);
  for (const importPath of imports) await validateStylesheet(path.resolve(path.dirname(normalized), importPath));
  activeStack.delete(normalized);
}
await validateStylesheet(entryPath);

for (const manifestPath of [
  path.join(stylesDirectory, 'legacy-feature-manifest.css'),
  path.join(stylesDirectory, 'legacy-layout-manifest.css'),
]) {
  const source = await readFile(manifestPath, 'utf8');
  if (!source.includes('Do not add new')) fail(`${path.relative(root, manifestPath)} must retain its quarantine guidance.`);
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
]) {
  if (legacyLayoutSource.includes(retiredLayout)) {
    fail(`Retired layout programme ${retiredLayout} must not be registered in legacy-layout-manifest.css.`);
  }
}

const applicationSource = await readFile(applicationPath, 'utf8');
const applicationImports = cssImports(applicationSource);
const requiredDesktopImports = [
  '../full-application-rebuild.css',
  '../route-composition-system.css',
  '../dashboard-role-workspace-rebuild.css',
  '../final-route-family-rebuild.css',
  '../navigation-contrast-phase-1.css',
  '../page-cleanup-phase-4.css',
  '../component-library-phase-3.css',
  '../ui-stabilization-contract.css',
  '../desktop-reference-layout.css',
  '../desktop-layout-regression-fixes.css',
  '../professional-ui-system.css',
  '../concentrix-dallmayr-shell.css',
  '../concentrix-dallmayr-dashboard.css',
  '../concentrix-operational-pages.css',
  '../concentrix-specialist-workspaces.css',
  '../concentrix-access-entry.css',
  '../concentrix-execution-details.css',
  '../concentrix-final-audit.css',
  '../canonical-shell-utilities.css',
];
for (const requiredImport of requiredDesktopImports) {
  if (!applicationImports.includes(requiredImport)) fail(`app/styles/application.css is missing ${requiredImport}.`);
}

const desktopReferenceIndex = applicationImports.indexOf('../desktop-reference-layout.css');
const desktopFixIndex = applicationImports.indexOf('../desktop-layout-regression-fixes.css');
const professionalUiIndex = applicationImports.indexOf('../professional-ui-system.css');
const concentrixShellIndex = applicationImports.indexOf('../concentrix-dallmayr-shell.css');
const concentrixDashboardIndex = applicationImports.indexOf('../concentrix-dallmayr-dashboard.css');
const concentrixOperationalIndex = applicationImports.indexOf('../concentrix-operational-pages.css');
const concentrixSpecialistIndex = applicationImports.indexOf('../concentrix-specialist-workspaces.css');
const concentrixAccessIndex = applicationImports.indexOf('../concentrix-access-entry.css');
const concentrixExecutionIndex = applicationImports.indexOf('../concentrix-execution-details.css');
const concentrixFinalAuditIndex = applicationImports.indexOf('../concentrix-final-audit.css');
const shellUtilitiesIndex = applicationImports.indexOf('../canonical-shell-utilities.css');
const responsiveAuthorityIndex = applicationImports.indexOf('../responsive-runtime-authority.css');
if (!(
  desktopReferenceIndex >= 0
  && desktopFixIndex === desktopReferenceIndex + 1
  && professionalUiIndex === desktopFixIndex + 1
  && concentrixShellIndex === professionalUiIndex + 1
  && concentrixDashboardIndex === concentrixShellIndex + 1
  && concentrixOperationalIndex === concentrixDashboardIndex + 1
  && concentrixSpecialistIndex === concentrixOperationalIndex + 1
  && concentrixAccessIndex === concentrixSpecialistIndex + 1
  && concentrixExecutionIndex === concentrixAccessIndex + 1
  && concentrixFinalAuditIndex === concentrixExecutionIndex + 1
  && shellUtilitiesIndex === concentrixFinalAuditIndex + 1
  && responsiveAuthorityIndex === shellUtilitiesIndex + 1
)) {
  fail('Desktop reference/fixes/professional UI, Concentrix migration layers and canonical shell utilities must load consecutively before responsive authority.');
}

const responsiveImport = '../responsive-mobile-tablet.css';
if (applicationImports.at(-1) !== responsiveImport) {
  fail(`The unified responsive contract must be the final application import; found ${applicationImports.at(-1)}.`);
}

for (const retiredImport of [
  '../mobile-functional-experience.css',
  '../mobile-menu-stacking-fix.css',
  '../mobile-overhaul.css',
  '../mobile-universal-phone.css',
  '../mobile-browser-native.css',
]) {
  if (applicationImports.includes(retiredImport)) fail(`Retired responsive layer ${retiredImport} must not be registered.`);
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
if (!desktopRailSource.includes('function NavIcon') || !desktopRailSource.includes('<svg')) fail('DesktopNavigationRail must use consistent SVG navigation icons.');
if (desktopRailSource.includes('navigationGlyph(')) fail('DesktopNavigationRail must not regress to generated text-abbreviation icons.');

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
console.log(`Style architecture check passed: ${visited.size} stylesheets registered with retired legacy shell/full-app/page-template programmes replaced by canonical Concentrix ownership, shared foundations, shell utilities and the final mobile/tablet authority.`);
