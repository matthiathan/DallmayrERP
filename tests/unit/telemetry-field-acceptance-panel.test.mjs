import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Test Center exposes an evidence-based field acceptance panel', async () => {
  const [page, panel] = await Promise.all([
    read('app/telemetry/test-center/page.tsx'),
    read('components/features/TelemetryFieldAcceptance.tsx'),
  ]);

  assert.match(page, /TelemetryFieldAcceptance/);
  assert.match(panel, /Field acceptance/);
  assert.match(panel, /search_telemetry_test_devices/);
  assert.match(panel, /get_telemetry_test_logs/);

  for (const label of [
    'Device contact',
    'Cellular transport',
    'Test session acknowledged',
    'Logs streaming',
    'Machine interface identified',
    'Decoder profile applied',
    'Product selection evidence',
    'Vend evidence',
    'Cup counter evidence',
  ]) {
    assert.ok(panel.includes(label), `missing acceptance check: ${label}`);
  }

  assert.match(panel, /passedCount/);
  assert.match(panel, /Open this Test Center from Device Management/);
});
