type DeviceContactFields = {
  status?: string | null;
  last_heartbeat_at?: string | null;
  last_seen_at?: string | null;
  last_upload_at?: string | null;
  last_config_ack_at?: string | null;
  heartbeat_interval_minutes?: number | null;
};

type DeviceConfigFields = {
  last_config_at?: string | null;
  last_config_ack_at?: string | null;
};

export type DeviceConnectionState = {
  key: 'online' | 'delayed' | 'offline' | 'disabled' | 'unknown' | 'never_seen';
  label: 'Online' | 'Delayed' | 'Offline' | 'Disabled' | 'Unknown' | 'Never seen';
  reason: string;
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
  const contactAt = deviceContactAt(device);
  if (device.status !== 'active') return { key: 'disabled', label: 'Disabled', contactAt, reason: 'Controller is disabled.' };
  const timestamp = timeFor(contactAt);
  if (timestamp === null) return { key: 'never_seen', label: 'Never seen', contactAt: null, reason: 'No device contact has been recorded.' };
  const interval = device.heartbeat_interval_minutes;
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) {
    return { key: 'unknown', label: 'Unknown', contactAt, reason: 'Heartbeat interval not configured or unavailable.' };
  }
  if (timestamp > now) return { key: 'unknown', label: 'Unknown', contactAt, reason: 'Device contact timestamp is in the future.' };
  const elapsed = now - timestamp;
  if (elapsed <= interval * 2 * 60_000) return { key: 'online', label: 'Online', contactAt, reason: 'Confirmed device contact within two expected heartbeat intervals.' };
  if (elapsed <= interval * 5 * 60_000) return { key: 'delayed', label: 'Delayed', contactAt, reason: 'Device contact is more than two expected heartbeat intervals old.' };
  return { key: 'offline', label: 'Offline', contactAt, reason: 'No device contact for more than five expected heartbeat intervals.' };
}

export function deviceConfigSyncState(device: DeviceConfigFields): DeviceConfigSyncState {
  const sentAt = timeFor(device.last_config_at);
  const acknowledgedAt = timeFor(device.last_config_ack_at);
  if (sentAt === null) return { key: 'not_sent', label: 'No config sent', timestamp: null };
  if (acknowledgedAt === null || acknowledgedAt < sentAt) return { key: 'pending', label: 'Awaiting device ACK', timestamp: device.last_config_at ?? null };
  return { key: 'acknowledged', label: 'Acknowledged', timestamp: device.last_config_ack_at ?? null };
}
