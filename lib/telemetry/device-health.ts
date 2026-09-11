export const DEVICE_ONLINE_WINDOW_MS = 30 * 60 * 1000;

type DeviceContactFields = {
  status?: string | null;
  last_heartbeat_at?: string | null;
  last_seen_at?: string | null;
  last_upload_at?: string | null;
  last_config_ack_at?: string | null;
};

type DeviceConfigFields = {
  last_config_at?: string | null;
  last_config_ack_at?: string | null;
};

export type DeviceConnectionState = {
  key: 'online' | 'offline' | 'disabled';
  label: 'Online' | 'Offline' | 'Disabled' | 'Never connected';
  contactAt: string | null;
};

export type DeviceConfigSyncState = {
  key: 'acknowledged' | 'pending' | 'not_sent';
  label: 'Acknowledged' | 'Awaiting device ACK' | 'No config sent';
  timestamp: string | null;
};

function timeFor(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function deviceContactAt(device: DeviceContactFields) {
  const candidates = [
    device.last_heartbeat_at,
    device.last_seen_at,
    device.last_upload_at,
    device.last_config_ack_at,
  ].flatMap((value) => {
    const timestamp = timeFor(value);
    return timestamp === null || !value ? [] : [{ timestamp, value }];
  });
  return candidates.reduce<{ timestamp: number; value: string } | null>(
    (latest, candidate) => !latest || candidate.timestamp > latest.timestamp ? candidate : latest,
    null,
  )?.value ?? null;
}

export function deviceConnectionState(device: DeviceContactFields, now = Date.now()): DeviceConnectionState {
  if (device.status !== 'active') return { key: 'disabled', label: 'Disabled', contactAt: deviceContactAt(device) };
  const contactAt = deviceContactAt(device);
  const timestamp = timeFor(contactAt);
  if (timestamp === null) return { key: 'offline', label: 'Never connected', contactAt: null };
  if (Math.max(0, now - timestamp) <= DEVICE_ONLINE_WINDOW_MS) return { key: 'online', label: 'Online', contactAt };
  return { key: 'offline', label: 'Offline', contactAt };
}

export function deviceConfigSyncState(device: DeviceConfigFields): DeviceConfigSyncState {
  const sentAt = timeFor(device.last_config_at);
  const acknowledgedAt = timeFor(device.last_config_ack_at);
  if (sentAt === null) return { key: 'not_sent', label: 'No config sent', timestamp: null };
  if (acknowledgedAt === null || acknowledgedAt < sentAt) return { key: 'pending', label: 'Awaiting device ACK', timestamp: device.last_config_at ?? null };
  return { key: 'acknowledged', label: 'Acknowledged', timestamp: device.last_config_ack_at ?? null };
}
