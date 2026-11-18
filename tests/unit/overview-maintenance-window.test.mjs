import assert from 'node:assert/strict';
import test from 'node:test';
import { maintenanceDayRange } from '../../lib/telemetry/overview-maintenance.ts';

test('today maintenance follows Johannesburg midnight even when UTC is still yesterday', () => {
  assert.deepEqual(maintenanceDayRange(new Date('2026-11-15T22:30:00Z')), {
    from: '2026-11-15T22:00:00.000Z', until: '2026-11-16T22:00:00.000Z',
  });
});
