import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspacePath = new URL('../../components/telemetry-platform/TelemetryDevicesWorkspace.tsx', import.meta.url);
const paginationPath = new URL('../../components/telemetry-platform/DeviceRegisterPagination.tsx', import.meta.url);

test('device management renders only the active display page', async () => {
  const source = await readFile(workspacePath, 'utf8');

  assert.match(source, /const \[page, setPage\] = useState\(1\)/);
  assert.match(source, /const \[pageSize, setPageSize\] = useState\(50\)/);
  assert.match(source, /const pageRows = useMemo\(/);
  assert.match(source, /pageRows\.map\(\(device\) =>/);
  assert.equal((source.match(/filtered\.map\(\(device\) =>/g) ?? []).length, 0);
});

test('device management resets and clamps display pagination safely', async () => {
  const source = await readFile(workspacePath, 'utf8');

  assert.match(source, /setPage\(1\);\n  }, \[modeFilter, search, statusFilter, transportFilter\]\);/);
  assert.match(source, /setPage\(\(current\) => Math\.min\(current, pageCount\)\)/);
  assert.match(source, /setPage\(Math\.floor\(requestedIndex \/ pageSize\) \+ 1\)/);
});

test('pagination control offers bounded 25, 50 and 100 row choices', async () => {
  const source = await readFile(paginationPath, 'utf8');

  assert.match(source, /const PAGE_SIZES = \[25, 50, 100\] as const/);
  assert.match(source, /aria-label="Telemetry device pages"/);
  assert.match(source, /aria-label="Rows per page"/);
  assert.match(source, /First device page/);
  assert.match(source, /Last device page/);
});
