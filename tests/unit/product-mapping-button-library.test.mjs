import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspacePath = new URL('../../components/features/ProductMappingWorkspace.tsx', import.meta.url);
const presetPath = new URL('../../lib/telemetry/machine-button-presets.ts', import.meta.url);

test('product mapping keeps physical button number separate from raw MDB selection code', async () => {
  const source = await readFile(workspacePath, 'utf8');

  assert.equal(source.includes('`MDB-${buttonNumber}`'), false);
  assert.match(source, /selectionCode: existing\?\.selection_code\?\.trim\(\) \|\| ''/);
  assert.match(source, /current\[index\] \?\? \{ buttonNumber, selectionCode: '', productId: '' \}/);
  assert.match(source, /Physical button numbers and MDB codes are separate\./);
});

test('observed telemetry codes can be captured and assigned to a physical button', async () => {
  const source = await readFile(workspacePath, 'utf8');

  assert.match(source, /const \[pendingSelectionCode, setPendingSelectionCode\] = useState\(''\)/);
  assert.match(source, /Capture code/);
  assert.match(source, /Use observed code…/);
  assert.match(source, /Assign \{pendingSelectionCode\}/);
  assert.match(source, /list="observed-telemetry-selection-codes"/);
});

test('verified machine button presets include the field-tested XS Grande variants', async () => {
  const source = await readFile(presetPath, 'utf8');

  assert.match(source, /modelKey: 'RHEAVENDORS XS GRANDE E5 PRO'[\s\S]*?buttonCount: 10/);
  assert.match(source, /modelKey: 'RHEAVENDORS XS GRANDE I6 INSTANT'[\s\S]*?buttonCount: 10/);
  assert.match(source, /modelKey: 'RHEAVENDORS XX MICRO'[\s\S]*?buttonCount: 6/);
  assert.match(source, /modelKey: 'SIELAFF BELLUNO'[\s\S]*?buttonCount: 14/);
});
