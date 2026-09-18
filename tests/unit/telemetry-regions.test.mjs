import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const types = readFileSync(new URL('../../types/dallmayrerp.ts', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../../components/layout/AppShell.tsx', import.meta.url), 'utf8');
const selector = readFileSync(new URL('../../components/telemetry-platform/TelemetryRegionSelector.tsx', import.meta.url), 'utf8');
const machineControl = readFileSync(new URL('../../components/telemetry-platform/MachineTelemetryRegionControl.tsx', import.meta.url), 'utf8');

test('telemetry regions are explicitly typed', () => {
  assert.match(types, /export type TelemetryRegion = 'south_africa' \| 'dubai' \| 'europe'/);
  assert.match(types, /telemetry_region: TelemetryRegion \| null/);
});

test('app shell requires a provisioned telemetry region', () => {
  assert.match(shell, /TelemetryRegionRequired/);
  assert.match(shell, /TelemetryRegionSelector/);
  assert.match(shell, /const requiresTelemetryRegion = !userDetails\?\.telemetry_region/);
  assert.doesNotMatch(shell, /<NavigationIcon kind="pin" \/>South Africa/);
});

test('region selector supports South Africa, Dubai and Europe without AI copy', () => {
  assert.match(selector, /value: 'south_africa', label: 'South Africa'/);
  assert.match(selector, /value: 'dubai', label: 'Dubai'/);
  assert.match(selector, /value: 'europe', label: 'Europe'/);
  assert.match(selector, /set_my_telemetry_region/);
  assert.match(selector, /set_user_telemetry_region/);
  assert.doesNotMatch(selector, /AI insights/i);
});

test('machine region moves use the protected region RPC', () => {
  assert.match(machineControl, /set_machine_telemetry_region/);
  assert.match(machineControl, /linked telemetry devices/);
  assert.match(machineControl, /userDetails\?\.role === 'admin' \|\| userDetails\?\.role === 'operations'/);
});
