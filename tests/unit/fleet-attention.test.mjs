import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildFleetAttentionItems } from '../../lib/telemetry/fleet-attention.ts';

const NOW = Date.UTC(2026, 8, 11, 10, 0, 0);
const dashboard = await readFile(new URL('../../components/telemetry-platform/TelevendFleetDashboard.tsx', import.meta.url), 'utf8');

function activeDevice(overrides = {}) {
  return {
    id: 'device-1',
    device_code: 'DALL-TEL-001',
    machine_id: 'machine-1',
    status: 'active',
    last_heartbeat_at: new Date(NOW - (5 * 60 * 1000)).toISOString(),
    last_seen_at: null,
    last_upload_at: null,
    last_config_at: null,
    last_config_ack_at: null,
    last_transport: 'cellular',
    wifi_rssi: null,
    cellular_csq: 20,
    cellular_operator: 'Vodacom',
    ...overrides,
  };
}

test('fleet attention prioritizes offline devices and does not duplicate them as missing-network exceptions', () => {
  const devices = [
    activeDevice({ id: 'offline', device_code: 'DALL-TEL-OFF', last_heartbeat_at: new Date(NOW - (31 * 60 * 1000)).toISOString(), last_transport: null }),
    activeDevice({ id: 'low-data', device_code: 'DALL-TEL-LOW' }),
  ];
  const balances = [{ device_id: 'low-data', remaining_bytes: 20_000_000, alert_level: 'low' }];

  const items = buildFleetAttentionItems(devices, balances, NOW);

  assert.deepEqual(items.map((item) => [item.deviceId, item.kind]), [
    ['offline', 'offline'],
    ['low-data', 'sim_balance'],
  ]);
});

test('fleet attention identifies pending configuration, critical SIM balance, and online signal gaps', () => {
  const sentAt = new Date(NOW - (10 * 60 * 1000)).toISOString();
  const devices = [
    activeDevice({ id: 'config', device_code: 'DALL-TEL-CONFIG', last_config_at: sentAt, last_config_ack_at: null }),
    activeDevice({ id: 'sim', device_code: 'DALL-TEL-SIM' }),
    activeDevice({ id: 'network', device_code: 'DALL-TEL-NETWORK', last_transport: 'wifi', wifi_rssi: null }),
    activeDevice({ id: 'disabled', device_code: 'DALL-TEL-DISABLED', status: 'disabled', last_transport: null }),
  ];
  const balances = [{ device_id: 'sim', remaining_bytes: 0, alert_level: 'depleted' }];

  const items = buildFleetAttentionItems(devices, balances, NOW);

  assert.deepEqual(items.map((item) => [item.deviceId, item.kind, item.severity]), [
    ['sim', 'sim_balance', 'critical'],
    ['config', 'config', 'warning'],
    ['network', 'network', 'warning'],
  ]);
  assert.equal(items.find((item) => item.deviceId === 'config')?.occurredAt, sentAt);
});

test('the fleet dashboard exposes the actionable attention queue', () => {
  assert.match(dashboard, /data-fleet-attention-queue="v1"/);
  assert.match(dashboard, /buildFleetAttentionItems/);
  assert.match(dashboard, /from\('telemetry_devices'\)\.select\('id,device_code,machine_id,status,last_heartbeat_at/);
  assert.match(dashboard, /href=\{`\/machines\/\$\{machineId\}`\}/);
  assert.match(dashboard, /href=\{`\/telemetry\/devices\?device=\$\{encodeURIComponent\(item\.deviceCode\)\}`\}/);
  assert.match(dashboard, /href=\{`\/telemetry\/test-center\?device=\$\{encodeURIComponent\(item\.deviceCode\)\}`\}/);
});
