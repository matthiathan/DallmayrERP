import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TelemetryFirmwareStatus } from '../../components/telemetry-platform/TelemetryFirmwareStatus.tsx';
test('portal distinguishes unsupported rollback from a working remote-update capability', () => {
  const html = renderToStaticMarkup(
    createElement(TelemetryFirmwareStatus, {
      state: {
        rollback_capable: false,
        trust_ready: false,
        running_version: '6.8.53',
        reported_at: '2026-11-17T10:00:00Z',
        highwater: 0,
      },
      now: Date.parse('2026-11-17T10:10:00Z'),
    }),
  );
  assert.match(html, /Cellular is always preferred/);
  assert.match(html, /USB bootloader setup required/);
  assert.match(html, /Public trust keys required/);
  assert.match(html, /outdated/);
});
