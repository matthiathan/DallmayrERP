import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoPath = (...parts) => join(repoRoot, ...parts);

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else files.push(path);
  }
  return files;
}

test('legacy global styles remain quarantined behind the canonical stylesheet entry point', async () => {
  const [layout, index, manifest, globals] = await Promise.all([
    readFile(repoPath('app/layout.tsx'), 'utf8'),
    readFile(repoPath('app/styles/index.css'), 'utf8'),
    readFile(repoPath('app/styles/legacy-feature-manifest.css'), 'utf8'),
    readFile(repoPath('app/globals.css'), 'utf8'),
  ]);

  assert.match(layout, /import '\.\/styles\/index\.css';/);
  assert.doesNotMatch(layout, /globals\.css/);
  assert.match(index, /@import '\.\/legacy-feature-manifest\.css';/);
  assert.match(manifest, /compatibility quarantine/i);
  assert.match(manifest, /@import '\.\.\/globals\.css';/);
  assert.ok(globals.length > 0, 'legacy compatibility stylesheet must remain available while quarantined surfaces depend on it');

  const appFiles = await collectFiles(repoPath('app'));
  const unauthorizedImports = [];
  for (const file of appFiles) {
    const name = relative(repoRoot, file).replaceAll('\\', '/');
    if (name === 'app/styles/legacy-feature-manifest.css' || !/\.(?:css|ts|tsx|js|jsx|mjs)$/.test(name)) continue;
    const source = await readFile(file, 'utf8');
    if (/globals\.css/.test(source)) unauthorizedImports.push(name);
  }
  assert.deepEqual(unauthorizedImports, []);
});
