import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const repoFile = (path) => new URL(`../../${path}`, import.meta.url);

test('the app uses the canonical stylesheet entry point and the obsolete globals.css is retired', async () => {
  const layout = await readFile(repoFile('app/layout.tsx'), 'utf8');
  assert.match(layout, /import '\.\/styles\/index\.css';/);
  assert.doesNotMatch(layout, /globals\.css/);
  await assert.rejects(access(repoFile('app/globals.css')));
});
