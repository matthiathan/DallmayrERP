import { deviceConnectionState } from '@/lib/telemetry/device-health';
import { deviceDataHealth } from '@/lib/telemetry/data-health';

type Props = {
  device: (Parameters<typeof deviceConnectionState>[0] & { machine_id?: string | null }) | null;
  now: number;
  className?: string;
};

export function TelemetryHealthSummary({ device, now, className }: Props) {
  const connectivity = device ? deviceConnectionState(device, now) : { label: 'Unknown', reason: 'No telemetry device is assigned to this machine.' };
  const { communication, reporting } = deviceDataHealth(device?.machine_id ?? null);
  return <div className={className} aria-label="Independent telemetry health indicators">
    <div><span>Device connectivity</span><strong>● {connectivity.label}</strong><small>{connectivity.reason}</small></div>
    <div><span>Machine communication freshness</span><strong>? {communication.label}</strong><small>{communication.reason}</small></div>
    <div><span>Sales report freshness</span><strong>? {reporting.label}</strong><small>{reporting.reason}</small></div>
  </div>;
}
