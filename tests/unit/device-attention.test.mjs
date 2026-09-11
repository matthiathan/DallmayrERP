import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildFleetAttentionItems } from '../../lib/telemetry/fleet-attention.ts';

function device(overrides = {}) {
  return {
    id: 'device-1',
    device_code: 'TEL-001',
    machine_id: 'machine-1',
    status: 'active',
    last_heartbeat_at: '2026-09-11T08:00:00.000Z',
    last_seen_at: '2026-09-11T08:00:00.000Z',
    last_upload_at: '2026-09-11T08:00:00.000Z',
    last_config_at: null,
    last_config_ack_at: null,
    last_transport: 'cellular',
    wifi_rssi: null,
    cellular_csq: 20,
    cellular_operator: 'Vodacom',
    ...overrides,
  };
}

const now = new Date('2026-09-11T10:00:00.000Z').getTime();

test('fleet attention derives the four controller exception classes without duplicating offline network warnings', () => {
  const devices = [
    device({ id: 'offline', device_code: 'OFFLINE', last_heartbeat_at: '2026-09-11T08:00:00.000Z', last_seen_at: '2026-09-11T08:00:00.000Z', last_upload_at: '2026-09-11T08:00:00.000Z' }),
    device({ id: 'config', device_code: 'CONFIG', last_heartbeat_at: '2026-09-11T09:55:00.000Z', last_seen_at: '2026-09-11T09:55:00.000Z', last_upload_at: '2026-09-11T09:55:00.000Z', last_config_at: '2026-09-11T09:50:00.000Z', last_config_ack_at: '2026-09-11T09:00:00.000Z' }),
    device({ id: 'network', device_code: 'NETWORK', last_heartbeat_at: '2026-09-11T09:55:00.000Z', last_seen_at: '2026-09-11T09:55:00.000Z', last_upload_at: '2026-09-11T09:55:00.000Z', cellular_csq: null }),
    device({ id: 'balance', device_code: 'BALANCE', last_heartbeat_at: '2026-09-11T09:55:00.000Z', last_seen_at: '2026-09-11T09:55:00.000Z', last_upload_at: '2026-09-11T09:55:00.000Z' }),
  ];
  const balances = [{ device_id: 'balance', remaining_bytes: 1024, alert_level: 'critical' }];

  const items = buildFleetAttentionItems(devices, balances, now);

  assert.deepEqual(items.map((item) => item.kind), ['offline', 'sim_balance', 'config', 'network']);
  assert.equal(items.filter((item) => item.deviceId === 'offline' && item.kind === 'network').length, 0);
  assert.equal(items.find((item) => item.deviceId === 'balance')?.severity, 'critical');
});

test('alerts page surfaces controller exceptions alongside the existing audited machine-fault workflow', () => {
  const page = readFileSync(new URL('../../app/alerts/page.tsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../../components/telemetry-platform/DeviceAttentionPanel.tsx', import.meta.url), 'utf8');

  assert.match(page, /DeviceAttentionPanel/);
  assert.match(page, /<DeviceAttentionPanel \/>/);
  assert.match(page, /<AlarmCenter \/>/);
  assert.ok(page.indexOf('<DeviceAttentionPanel />') < page.indexOf('<AlarmCenter />'));

  assert.match(panel, /buildFleetAttentionItems/);
  assert.match(panel, /\.range\(offset, offset \+ DEVICE_PAGE_SIZE - 1\)/);
  assert.match(panel, /\/telemetry\/devices\?device=/);
  assert.match(panel, /\/telemetry\/test-center\?device=/);
  assert.doesNotMatch(panel, /set_telemetry_alarm_workflow/);
});
