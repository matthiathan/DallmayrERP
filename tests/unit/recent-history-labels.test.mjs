import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  recentHistoryDisplayLabel,
  recentRecordTarget,
} from '../../lib/productivity/recentHistoryLabels.ts';

test('recent history resolves supported record URLs without treating static routes as records', () => {
  assert.deepEqual(
    recentRecordTarget('/operations/service-jobs', 'job=11111111-1111-4111-8111-111111111111'),
    { kind: 'service-job', id: '11111111-1111-4111-8111-111111111111' },
  );
  assert.deepEqual(
    recentRecordTarget('/operations/deliveries', 'order=22222222-2222-4222-8222-222222222222'),
    { kind: 'delivery-order', id: '22222222-2222-4222-8222-222222222222' },
  );
  assert.deepEqual(recentRecordTarget('/customers/customer-123'), { kind: 'customer', id: 'customer-123' });
  assert.deepEqual(recentRecordTarget('/operations/assets/machine-123'), { kind: 'machine', id: 'machine-123' });
  assert.deepEqual(recentRecordTarget('/work/work-123'), { kind: 'work-item', id: 'work-123' });
  assert.deepEqual(recentRecordTarget('/warehouse/stock/stock-123'), { kind: 'stock-item', id: 'stock-123' });
  assert.equal(recentRecordTarget('/operations/assets/lifecycle'), null);
  assert.equal(recentRecordTarget('/operations/assets/scan'), null);
  assert.equal(recentRecordTarget('/work/execution'), null);
  assert.equal(recentRecordTarget('/warehouse/stock/scan'), null);
});

test('recent history never falls back to a technical identifier in the display label', () => {
  const uuid = '33333333-3333-4333-8333-333333333333';
  assert.equal(recentHistoryDisplayLabel('Scheduled Call Log'), 'Scheduled Call Log');
  assert.equal(recentHistoryDisplayLabel('Scheduled Call Log', 'SJ-2048'), 'Scheduled Call Log · SJ-2048');
  assert.equal(recentHistoryDisplayLabel('Customer', 'Acme Coffee (C-100)'), 'Customer · Acme Coffee (C-100)');
  assert.equal(recentHistoryDisplayLabel('', null), 'Record');
  assert.equal(recentHistoryDisplayLabel('Scheduled Call Log').includes(uuid), false);
});

test('Quick Access source uses business-label resolution instead of URL identifiers for history and pins', async () => {
  const source = await readFile(new URL('../../components/layout/EnterpriseProductivityHub.tsx', import.meta.url), 'utf8');
  assert.match(source, /recentRecordTarget\(pathname, search\)/);
  assert.match(source, /resolveRecentRecordLabel\(target\)/);
  assert.match(source, /currentDisplayLabel/);
  assert.doesNotMatch(source, /return `\$\{activeTitle\} · \$\{record\}`/);
  assert.doesNotMatch(source, /decodeURIComponent\(finalSegment\)/);
});
