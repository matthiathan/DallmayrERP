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
];
for (const requiredImport of requiredDesktopImports) {
  if (!applicationImports.includes(requiredImport)) fail(`app/styles/application.css is missing ${requiredImport}.`);
}

const desktopReferenceIndex = applicationImports.indexOf('../desktop-reference-layout.css');
const desktopFixIndex = applicationImports.indexOf('../desktop-layout-regression-fixes.css');
const professionalUiIndex = applicationImports.indexOf('../professional-ui-system.css');
const concentrixShellIndex = applicationImports.indexOf('../concentrix-dallmayr-shell.css');
const concentrixDashboardIndex = applicationImports.indexOf('../concentrix-dallmayr-dashboard.css');
const responsiveAuthorityIndex = applicationImports.indexOf('../responsive-runtime-authority.css');
if (!(
  desktopReferenceIndex >= 0
  && desktopFixIndex === desktopReferenceIndex + 1
  && professionalUiIndex === desktopFixIndex + 1
  && concentrixShellIndex === professionalUiIndex + 1
  && concentrixDashboardIndex === concentrixShellIndex + 1
  && responsiveAuthorityIndex > concentrixDashboardIndex
)) {
  fail('Desktop reference/fixes/professional UI and Concentrix shell/dashboard phases must load consecutively before responsive authority.');
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

const stabilizationSource = await readFile(path.join(root, 'app', 'ui-stabilization-contract.css'), 'utf8');
for (const requiredRule of ['--ui-canvas: #f5f0e6', '--ui-ink: #231f1a', '--ui-gold: #b8862f', '.dallmayr-sidebar']) {
  if (!stabilizationSource.includes(requiredRule)) fail(`Desktop stabilization is missing ${requiredRule}.`);
}

const professionalUiSource = await readFile(path.join(root, 'app', 'professional-ui-system.css'), 'utf8');
for (const requiredRule of ['--pro-radius-md: 12px', '.erp-panel', '.erp-table-shell', '.erp-toolbar', '.status-badge', ':focus-visible', '.dallmayr-sidebar-link svg']) {
  if (!professionalUiSource.includes(requiredRule)) fail(`Professional UI system is missing ${requiredRule}.`);
}

const concentrixShellSource = await readFile(path.join(root, 'app', 'concentrix-dallmayr-shell.css'), 'utf8');
for (const requiredRule of ['--cx-sidebar: 264px', '--cx-header: 88px', 'width: min(100%, 1600px)', 'box-shadow: inset 3px 0 0 var(--cx-gold)']) {
  if (!concentrixShellSource.includes(requiredRule)) fail(`Concentrix-derived shell is missing ${requiredRule}.`);
}

const concentrixDashboardSource = await readFile(path.join(root, 'app', 'concentrix-dallmayr-dashboard.css'), 'utf8');
for (const requiredRule of ['.cx-dashboard-hero', '.cx-dashboard-kpis', 'grid-template-columns: repeat(6, minmax(0, 1fr))', '.cx-dashboard-reporting']) {
  if (!concentrixDashboardSource.includes(requiredRule)) fail(`Concentrix-derived dashboard is missing ${requiredRule}.`);
}

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
for (const requiredRule of ['var(--ui-canvas', '.app-shell > .mobile-nav-backdrop', '.mobile-nav-portal-root', '.global-search-dialog', '.mobile-quick-bar', '.messaging-layout', 'overflow-x: auto !important', 'font-size: 16px !important', 'env(safe-area-inset-bottom)']) {
  if (!responsiveSource.includes(requiredRule)) fail(`Unified responsive contract is missing ${requiredRule}.`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`Style architecture check passed: ${visited.size} stylesheets registered with Concentrix shell/dashboard phases before the final mobile/tablet authority.`);
