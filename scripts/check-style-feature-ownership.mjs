import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const stylesDirectory = path.join(root, 'app', 'styles');
const manifestPath = path.join(stylesDirectory, 'legacy-feature-manifest.css');

function fail(message) {
  console.error(`Style feature ownership check failed: ${message}`);
  process.exitCode = 1;
}

function cssImports(source) {
  return [...source.matchAll(/@import\s+['"]([^'"]+\.css)['"];?/g)].map((match) => match[1]);
}

const expectedImports = [
  '../globals.css',
  './features/feature-widgets.css',
  './features/enterprise-ui.css',
  './page-families/stock-control.css',
  './page-families/professional-ops.css',
  './page-families/minimalist-operations.css',
  './features/density.css',
  './features/asset-ticket.css',
  './features/text-visibility-polish.css',
  './features/resizable-tables.css',
  './features/account-menu.css',
  './page-families/role-workspace-details.css',
  './page-families/reliability-machine-search.css',
  './page-families/operations-manager.css',
  './page-families/operational-admin-forms.css',
  './features/appearance-panel.css',
  './features/appearance-customization.css',
  './page-families/field-service-workflow.css',
  './page-families/operations-dispatch.css',
  './page-families/customer-360.css',
  './page-families/operations-exceptions.css',
  './themes/slate-sand-themes.css',
  './active-mobile-workspaces.css',
];

const manifest = await readFile(manifestPath, 'utf8');
const imports = cssImports(manifest);
if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) {
  fail(`legacy-feature-manifest.css must preserve the approved migration order ${JSON.stringify(expectedImports)}; found ${JSON.stringify(imports)}.`);
}

const retiredRootFeatureFiles = [
  'feature-widgets.css',
  'enterprise-ui.css',
  'stock-control.css',
  'professional-ops.css',
  'minimalist-operations.css',
  'density.css',
  'asset-ticket.css',
  'text-visibility-polish.css',
  'resizable-tables.css',
  'account-menu.css',
  'role-workspace-details.css',
  'reliability-machine-search.css',
  'operations-manager.css',
  'operational-admin-forms.css',
  'appearance-panel.css',
  'appearance-customization.css',
  'field-service-workflow.css',
  'operations-dispatch.css',
  'customer-360.css',
  'operations-exceptions.css',
  'slate-sand-themes.css',
];

for (const fileName of retiredRootFeatureFiles) {
  try {
    await access(path.join(root, 'app', fileName));
    fail(`app/${fileName} must not be restored; its live rules have a canonical owner under app/styles/.`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

for (const importPath of expectedImports.filter((item) => item.startsWith('./features/') || item.startsWith('./page-families/') || item.startsWith('./themes/'))) {
  try {
    await access(path.resolve(stylesDirectory, importPath));
  } catch {
    fail(`Canonical feature stylesheet ${importPath} is missing.`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log('Style feature ownership check passed: live feature CSS is classified under canonical ownership folders and retired app-root feature files remain absent.');
