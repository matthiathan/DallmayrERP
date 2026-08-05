import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const layoutPath = path.join(root, 'app', 'layout.tsx');
const stylesDirectory = path.join(root, 'app', 'styles');
const entryPath = path.join(stylesDirectory, 'index.css');

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
const registeredTargets = new Map();
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
  const duplicateImports = imports.filter((value, index) => imports.indexOf(value) !== index);
  if (duplicateImports.length > 0) {
    fail(`${path.relative(root, normalized)} contains duplicate imports: ${[...new Set(duplicateImports)].join(', ')}.`);
  }

  for (const importPath of imports) {
    if (/(?:^|\/)\w[\w-]*-final\.css$/i.test(importPath)) {
      fail(`${path.relative(root, normalized)} registers prohibited *-final.css layer ${importPath}.`);
    }
    const resolved = path.resolve(path.dirname(normalized), importPath);
    const firstOwner = registeredTargets.get(resolved);
    if (firstOwner && firstOwner !== normalized) {
      fail(`Stylesheet ${path.relative(root, resolved)} is registered by both ${path.relative(root, firstOwner)} and ${path.relative(root, normalized)}.`);
    } else {
      registeredTargets.set(resolved, normalized);
    }
    await validateStylesheet(resolved);
  }
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

const applicationPath = path.join(stylesDirectory, 'application.css');
const applicationSource = await readFile(applicationPath, 'utf8');
const applicationImports = cssImports(applicationSource);
for (const requiredApplicationImport of [
  '../full-application-rebuild.css',
  '../route-composition-system.css',
  '../dashboard-role-workspace-rebuild.css',
  '../final-route-family-rebuild.css',
  '../navigation-contrast-phase-1.css',
  '../page-cleanup-phase-4.css',
  '../component-library-phase-3.css',
  '../ui-stabilization-contract.css',
]) {
  if (!applicationImports.includes(requiredApplicationImport)) {
    fail(`app/styles/application.css is missing canonical import ${requiredApplicationImport}.`);
  }
}
if (applicationImports.at(-1) !== '../ui-stabilization-contract.css') {
  fail('ui-stabilization-contract.css must remain the final application import.');
}

const stabilizationPath = path.join(root, 'app', 'ui-stabilization-contract.css');
const stabilizationSource = await readFile(stabilizationPath, 'utf8');
for (const requiredRule of [
  '.dallmayr-sidebar',
  '.dallmayr-sidebar-link[aria-current=',
  '--ui-ink: #231f1a',
  '--ui-canvas: #f5f0e6',
  'outline: 3px solid',
]) {
  if (!stabilizationSource.includes(requiredRule)) {
    fail(`app/ui-stabilization-contract.css is missing required usability rule ${requiredRule}.`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`Style architecture check passed: ${visited.size} stylesheets registered through five canonical entry manifests with a locked final stabilization contract.`);
