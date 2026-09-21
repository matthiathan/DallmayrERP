import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Products is organized into four operator tasks without replacing mapping behavior', async () => {
  const [page, organizer, styles] = await Promise.all([
    read('app/products/page.tsx'),
    read('components/features/ProductsWorkspaceOrganizer.tsx'),
    read('components/features/ProductsWorkspaceOrganizer.module.css'),
  ]);

  assert.match(page, /ProductsWorkspaceOrganizer/);
  assert.match(organizer, /type ProductView = 'catalogue' \| 'mappings' \| 'unmapped' \| 'history'/);
  for (const label of ['Product Catalogue', 'Machine Mappings', 'Unmapped Selections', 'Mapping History']) {
    assert.ok(organizer.includes(label), `missing Products tab ${label}`);
  }
  assert.match(organizer, /<ProductMappingWorkspace \/>/);
  assert.match(organizer, /<FleetMachineSelectionCatalog \/>/);
  assert.match(organizer, /<SelectionLearnModePanel \/>/);
  assert.match(styles, /data-product-view='catalogue'/);
  assert.match(styles, /data-product-view='mappings'/);
  assert.match(styles, /data-product-view='unmapped'/);
  assert.match(styles, /data-product-view='history'/);
});

test('Test Center exposes task views while keeping remote session state persistent', async () => {
  const [page, organizer, styles, center] = await Promise.all([
    read('app/telemetry/test-center/page.tsx'),
    read('components/features/TestCenterWorkspaceOrganizer.tsx'),
    read('components/features/TestCenterWorkspaceOrganizer.module.css'),
    read('components/features/TelemetryTestCenter.tsx'),
  ]);

  assert.match(page, /TestCenterWorkspaceOrganizer/);
  assert.match(organizer, /type TestCenterView = 'console' \| 'events' \| 'commands' \| 'history'/);
  for (const label of ['Console', 'Important Events', 'Commands', 'Session History']) {
    assert.ok(organizer.includes(label), `missing Test Center tab ${label}`);
  }
  assert.match(organizer, /<TelemetryTestCenter \/>/);
  assert.match(styles, /data-test-center-view='events'/);
  assert.match(styles, /data-test-center-view='commands'/);
  assert.match(styles, /data-test-center-view='history'/);
  assert.match(center, /aria-label="Remote session state"/);
  assert.match(center, /importantLogKind/);
});
