import { BulkTelemetryEnrollmentControl } from '@/components/features/BulkTelemetryEnrollmentControl';
import { TelemetryCommissioningQueue } from '@/components/features/TelemetryCommissioningQueue';
import { TelemetryDeviceContextLinks } from '@/components/features/TelemetryDeviceContextLinks';
import { AppShell } from '@/components/layout/AppShell';
import { TelemetryDevicesWorkspace } from '@/components/telemetry-platform/TelemetryDevicesWorkspace';
import { TelemetryNetworkUsagePanel } from '@/components/telemetry-platform/TelemetryNetworkUsagePanel';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function TelemetryDevicesPage() {
  return (
    <AppShell>
      <LiveDataStatus refreshIntervalMs={15_000} />
      <TelemetryDevicesWorkspace />
      <TelemetryDeviceContextLinks />
      <BulkTelemetryEnrollmentControl />
      <TelemetryCommissioningQueue />
      <TelemetryNetworkUsagePanel />
    </AppShell>
  );
}
