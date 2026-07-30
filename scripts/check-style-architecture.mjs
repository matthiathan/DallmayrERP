import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const layoutPath = path.join(root, 'app', 'layout.tsx');
const entryPath = path.join(root, 'app', 'styles', 'index.css');

function fail(message) {
  console.error(`Style architecture check failed: ${message}`);
  process.exitCode = 1;
}

const layout = await readFile(layoutPath, 'utf8');
const layoutCssImports = [...layout.matchAll(/import\s+['"]([^'"]+\.css)['"];?/g)].map((match) => match[1]);

if (layoutCssImports.length !== 1 || layoutCssImports[0] !== './styles/index.css') {
  fail(`app/layout.tsx must import only ./styles/index.css; found ${JSON.stringify(layoutCssImports)}.`);
}

const entry = await readFile(entryPath, 'utf8');
const entryImports = [...entry.matchAll(/@import\s+['"]([^'"]+\.css)['"];?/g)].map((match) => match[1]);
const duplicateImports = entryImports.filter((value, index) => entryImports.indexOf(value) !== index);

if (duplicateImports.length > 0) {
  fail(`app/styles/index.css contains duplicate imports: ${[...new Set(duplicateImports)].join(', ')}.`);
}

if (entryImports.some((value) => /(?:^|\/)\w[\w-]*-final\.css$/i.test(value))) {
  fail('app/styles/index.css must not register new *-final.css compatibility layers.');
}

const requiredImports = [
  './tokens.css',
  './foundations.css',
  './navigation-contract.css',
  './compatibility-overrides.css',
];

for (const requiredImport of requiredImports) {
  if (!entryImports.includes(requiredImport)) {
    fail(`app/styles/index.css is missing required design-system import ${requiredImport}.`);
  }
}

if (entryImports[0] !== './tokens.css') {
  fail('Design tokens must be the first import in app/styles/index.css.');
}

for (const importPath of entryImports) {
  const resolved = path.resolve(path.dirname(entryPath), importPath);
  try {
    await access(resolved);
  } catch {
    fail(`Stylesheet import ${importPath} does not resolve to an existing file.`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`Style architecture check passed: ${entryImports.length} ordered stylesheets behind one application entry point.`);
