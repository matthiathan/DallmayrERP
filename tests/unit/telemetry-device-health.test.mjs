import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEVICE_ONLINE_WINDOW_MS,
  deviceConfigSyncState,
  deviceConnectionState,
  deviceContactAt,
} from '../../lib/telemetry/device-health.ts';

const NOW = Date.UTC(2026, 8, 11, 10, 0, 0);

test('device health uses the newest confirmed contact and the agreed 30-minute online window', () => {
  const staleHeartbeat = new Date(NOW - (45 * 60 * 1000)).toISOString();
  const freshUpload = new Date(NOW - (5 * 60 * 1000)).toISOString();
  const device = { status: 'active', last_heartbeat_at: staleHeartbeat, last_seen_at: null, last_upload_at: freshUpload, last_config_ack_at: null };

  assert.equal(deviceContactAt(device), freshUpload);
  assert.equal(deviceConnectionState(device, NOW).key, 'online');
  assert.equal(deviceConnectionState({ ...device, last_upload_at: new Date(NOW - DEVICE_ONLINE_WINDOW_MS - 1).toISOString() }, NOW).key, 'offline');
  assert.equal(deviceConnectionState({ status: 'active' }, NOW).label, 'Never connected');
  assert.equal(deviceConnectionState({ ...device, status: 'disabled' }, NOW).key, 'disabled');
});

test('device health distinguishes an acknowledged configuration from pending or unsent configuration', () => {
  const sent = new Date(NOW - 60_000).toISOString();
  const acknowledged = new Date(NOW - 30_000).toISOString();

  assert.deepEqual(deviceConfigSyncState({ last_config_at: sent, last_config_ack_at: acknowledged }), { key: 'acknowledged', label: 'Acknowledged', timestamp: acknowledged });
  assert.deepEqual(deviceConfigSyncState({ last_config_at: sent, last_config_ack_at: null }), { key: 'pending', label: 'Awaiting device ACK', timestamp: sent });
  assert.deepEqual(deviceConfigSyncState({ last_config_at: null, last_config_ack_at: null }), { key: 'not_sent', label: 'No config sent', timestamp: null });
});
