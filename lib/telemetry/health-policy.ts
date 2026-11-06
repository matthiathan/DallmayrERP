import { getSupabaseClient } from '@/lib/supabase/client';

export type DeviceHealthPolicy = { device_id: string; heartbeat_interval_minutes: number | null };

export async function loadDeviceHealthPolicies(): Promise<DeviceHealthPolicy[]> {
  const { data, error } = await getSupabaseClient().rpc('get_telemetry_device_policy_states');
  if (error) throw new Error(`Device heartbeat policies unavailable: ${error.message}`);
  if (!Array.isArray(data)) throw new Error('Device heartbeat policies returned an invalid response.');
  return data as DeviceHealthPolicy[];
}

export function withDeviceHealthPolicies<T extends { id: string }>(devices: T[], policies: DeviceHealthPolicy[]) {
  const byDevice = new Map(policies.map((policy) => [policy.device_id, policy.heartbeat_interval_minutes]));
  return devices.map((device) => ({ ...device, heartbeat_interval_minutes: byDevice.get(device.id) ?? null }));
}
