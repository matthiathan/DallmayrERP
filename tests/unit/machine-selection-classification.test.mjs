import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getMachineSelectionProfile } from '../../lib/telemetry/machine-button-presets.ts';

const catalogPath = new URL('../../components/features/FleetMachineSelectionCatalog.tsx', import.meta.url);

test('verified direct-button models return their physical selection counts', () => {
  assert.deepEqual(getMachineSelectionProfile('RHEAVENDORS XS GRANDE E5 PRO'), {
    mode: 'direct-buttons',
    buttonCount: 10,
    verified: true,
    note: 'Rheavendors XS Grande E5 has 10 direct selections.',
  });
  assert.equal(getMachineSelectionProfile('SIELAFF BELLUNO').buttonCount, 14);
  assert.equal(getMachineSelectionProfile('RHEAVENDORS XX MICRO').buttonCount, 6);
  assert.equal(getMachineSelectionProfile('LARHEA GRANDE E5').buttonCount, 12);
});

test('touchscreen families learn logical selections rather than inventing physical buttons', () => {
  for (const model of [
    'DR COFFEE MINI BAR',
    'DR COFFEE F10',
    'DR COFFEE F11 BIG PLUS',
    'DR COFFEE F12 BIG PLUS',
    'DR COFFEE M12',
    'VERONA F12 BIG PLUS',
    'VICENZA F11 BIG PLUS',
    'VENEZIA F10',
    'DOT DALLMAYR ONE TOUCH',
    'SIELAFF PIACENTO TOUCH',
  ]) {
    const profile = getMachineSelectionProfile(model);
    assert.equal(profile.mode, 'touchscreen', model);
    assert.equal(profile.buttonCount, null, model);
  }
});

test('fleet accessories are excluded from beverage selection mapping', () => {
  for (const model of [
    'MILK COOLER BCW-25A',
    'DR COFFEE MILK COOLER',
    'NAYAX READER ASSY',
    'MDB COIN MECHANISM',
    'MACAP GRINDER',
    'NOTEREADER - JOFEMAR',
    'SIELAFF PAYMENT SYSTEM',
  ]) {
    assert.equal(getMachineSelectionProfile(model).mode, 'accessory', model);
  }
});

test('unknown machines fail safe to manual verification', () => {
  const profile = getMachineSelectionProfile('PILOT SPRINT 5S INSTANT');
  assert.equal(profile.mode, 'manual');
  assert.equal(profile.verified, false);
  assert.equal(profile.buttonCount, null);
});

test('Products page catalog paginates the fleet and defaults to mappable assets', async () => {
  const source = await readFile(catalogPath, 'utf8');
  assert.match(source, /const PAGE_SIZE = 1000/);
  assert.match(source, /\.range\(from, from \+ PAGE_SIZE - 1\)/);
  assert.match(source, /useState<CatalogFilter>\('mappable'\)/);
  assert.match(source, /row\.profile\.mode !== 'accessory'/);
  assert.match(source, /Learn from telemetry/);
  assert.match(source, /verified direct-button layouts/);
});
