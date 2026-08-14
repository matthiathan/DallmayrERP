import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');

test('ErpLayout owns the high-level surface and command primitives', async () => {
  const source = await read('components/ui/ErpLayout.tsx');
  for (const exportName of ['ErpSurface', 'ErpSectionHeader', 'ErpCommandBar', 'ErpPage', 'ErpPageHeader']) {
    assert.match(source, new RegExp(`export function ${exportName}\\b`));
  }
  assert.match(source, /className=\{joinClasses\('erp-surface', 'ds-surface'/);
  assert.match(source, /className=\{joinClasses\('erp-command-bar', 'ds-surface', 'ds-command-bar'/);
});

test('WorkspacePrimitives is compatibility-only and delegates to ErpLayout', async () => {
  const source = await read('components/ui/WorkspacePrimitives.tsx');
  assert.match(source, /ErpSurface as WorkspaceSurface/);
  assert.match(source, /ErpSectionHeader as WorkspaceSectionHeader/);
  assert.match(source, /ErpCommandBar as WorkspaceCommandBar/);
  assert.doesNotMatch(source, /function Workspace/);
  assert.doesNotMatch(source, /<section/);
});

test('PageToolbar consumes ErpLayout directly', async () => {
  const source = await read('components/ui/PageToolbar.tsx');
  assert.match(source, /ErpCommandBar, ErpSectionHeader/);
  assert.match(source, /from '@\/components\/ui\/ErpLayout'/);
  assert.doesNotMatch(source, /WorkspacePrimitives/);
});

test('core route shells no longer mix legacy surface classes with ErpLayout', async () => {
  const paths = [
    'app/operations/service-jobs/page.tsx',
    'app/operations/deliveries/page.tsx',
    'app/operations/assets/page.tsx',
    'app/executive/reports/page.tsx',
  ];

  for (const path of paths) {
    const source = await read(path);
    assert.match(source, /<ErpPage\b/, `${path} must use ErpPage`);
    assert.match(source, /<ErpPageHeader\b/, `${path} must use ErpPageHeader`);
    for (const legacy of ['page-header', 'hero-panel', 'spatial-card', 'neo-card']) {
      assert.equal(source.includes(legacy), false, `${path} must not contain ${legacy}`);
    }
  }
});
