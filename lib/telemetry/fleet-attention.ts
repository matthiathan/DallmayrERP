import { deviceConfigSyncState, deviceConnectionState } from './device-health';

export type FleetAttentionDevice = {
  id: string;
  device_code: string;
  machine_id: string | null;
  status: string | null;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
  last_upload_at: string | null;
  last_config_at: string | null;
  last_config_ack_at: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
};

export type FleetAttentionBalance = {
  device_id: string;
  remaining_bytes: number | null;
  alert_level: string;
};

export type FleetAttentionKind = 'offline' | 'config' | 'sim_balance' | 'network';
export type FleetAttentionSeverity = 'critical' | 'warning';

export type FleetAttentionItem = {
  id: string;
  kind: FleetAttentionKind;
  severity: FleetAttentionSeverity;
  priority: number;
  deviceId: string;
  deviceCode: string;
  machineId: string | null;
  occurredAt: string | null;
  remainingBytes: number | null;
  balanceAlert: 'low' | 'critical' | 'depleted' | null;
  lastTransport: 'wifi' | 'cellular' | null;
};

function balanceLevel(level: string | null | undefined): FleetAttentionItem['balanceAlert'] {
  if (level === 'low' || level === 'critical' || level === 'depleted') return level;
  return null;
}

function networkSignalIsMissing(device: FleetAttentionDevice) {
  if (!device.last_transport) return true;
  if (device.last_transport === 'wifi') return typeof device.wifi_rssi !== 'number';
  return typeof device.cellular_csq !== 'number';
}

function sortItems(left: FleetAttentionItem, right: FleetAttentionItem) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  const leftTime = left.occurredAt ? new Date(left.occurredAt).getTime() : Number.NEGATIVE_INFINITY;
  const rightTime = right.occurredAt ? new Date(right.occurredAt).getTime() : Number.NEGATIVE_INFINITY;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.deviceCode.localeCompare(right.deviceCode);
}

/**
 * Produces a concise, actionable set of device exceptions for the fleet dashboard.
 * Offline devices deliberately do not also receive a network-signal exception: the
 * loss of contact is the more urgent, actionable problem.
 */
export function buildFleetAttentionItems(
  devices: FleetAttentionDevice[],
  balances: FleetAttentionBalance[],
  now = Date.now(),
): FleetAttentionItem[] {
  const balancesByDevice = new Map(balances.map((balance) => [balance.device_id, balance]));
  const items: FleetAttentionItem[] = [];

  for (const device of devices) {
    if (device.status !== 'active') continue;

    const connection = deviceConnectionState(device, now);
    const config = deviceConfigSyncState(device);
    const balance = balancesByDevice.get(device.id);
    const level = balanceLevel(balance?.alert_level);
    const base = {
      deviceId: device.id,
      deviceCode: device.device_code,
      machineId: device.machine_id,
      remainingBytes: balance?.remaining_bytes ?? null,
      balanceAlert: level,
      lastTransport: device.last_transport,
    };

    if (connection.key === 'offline') {
      items.push({
        ...base,
        id: `${device.id}:offline`,
        kind: 'offline',
        severity: 'critical',
        priority: 0,
        occurredAt: connection.contactAt,
      });
    }

    if (level) {
      items.push({
        ...base,
        id: `${device.id}:sim_balance`,
        kind: 'sim_balance',
        severity: level === 'low' ? 'warning' : 'critical',
        priority: level === 'low' ? 3 : 1,
        occurredAt: null,
      });
    }

    if (config.key === 'pending') {
      items.push({
        ...base,
        id: `${device.id}:config`,
        kind: 'config',
        severity: 'warning',
        priority: 2,
        occurredAt: config.timestamp,
      });
    }

    if (connection.key === 'online' && networkSignalIsMissing(device)) {
      items.push({
        ...base,
        id: `${device.id}:network`,
        kind: 'network',
        severity: 'warning',
        priority: 4,
        occurredAt: connection.contactAt,
      });
    }
  }

  return items.sort(sortItems);
}
