import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TelemetryHealthSummary } from '../../components/telemetry-platform/TelemetryHealthSummary.tsx';
import { withDeviceHealthPolicies } from '../../lib/telemetry/health-policy.ts';

const NOW = Date.UTC(2026, 10, 6, 10);
test('rendered snapshot distinguishes online device from unverified machine and sales information', () => {
  const markup = renderToStaticMarkup(createElement(TelemetryHealthSummary, {
    device: { status: 'active', machine_id: 'machine-1', last_seen_at: new Date(NOW).toISOString(), heartbeat_interval_minutes: 5 }, now: NOW,
  }));
  assert.match(markup, /Device connectivity/);
  assert.match(markup, /Online/);
  assert.match(markup, /Machine communication freshness/);
  assert.match(markup, /Sales report freshness/);
  assert.equal((markup.match(/\? Unknown/g) ?? []).length, 2);
  assert.match(markup, /No sales alone does not indicate a fault/);
  assert.match(markup, /An upload does not prove/);
});

test('policy attachment is by device identity and never supplies a guessed default', () => {
  const rows = withDeviceHealthPolicies([{ id: 'a' }, { id: 'b' }], [{ device_id: 'a', heartbeat_interval_minutes: 5 }]);
  assert.equal(rows[0].heartbeat_interval_minutes, 5);
  assert.equal(rows[1].heartbeat_interval_minutes, null);
});

test('machines without assigned telemetry still expose all unknown indicators', () => {
  const markup = renderToStaticMarkup(createElement(TelemetryHealthSummary, { device: null, now: NOW }));
  assert.match(markup, /No telemetry device is assigned/);
  assert.match(markup, /Machine communication freshness/);
  assert.match(markup, /Sales report freshness/);
  assert.equal((markup.match(/Unknown/g) ?? []).length, 3);
});
