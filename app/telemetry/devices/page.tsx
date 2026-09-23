import { BulkTelemetryEnrollmentControl } from '@/components/features/BulkTelemetryEnrollmentControl';
import { TelemetryCommissioningQueue } from '@/components/features/TelemetryCommissioningQueue';
import { TelemetryDeviceContextLinks } from '@/components/features/TelemetryDeviceContextLinks';
import { AppShell } from '@/components/layout/AppShell';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';
import { TelemetryDevicesWorkspace } from '@/components/telemetry-platform/TelemetryDevicesWorkspace';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function TelemetryDevicesPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="Fleet controllers"
        description="Provision, assign and configure telemetry controllers, connectivity, reporting and prepaid data controls."
        title="Telemetry devices"
      >
        <LiveDataStatus refreshIntervalMs={15_000} />
        <TelemetryDeviceContextLinks />
        <BulkTelemetryEnrollmentControl />
        <TelemetryCommissioningQueue />
        <TelemetryDevicesWorkspace />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}