import { AppShell } from '@/components/layout/AppShell';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';
import { TelemetryDevicesWorkspace } from '@/components/telemetry-platform/TelemetryDevicesWorkspace';

export default function TelemetryDevicesPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="Fleet controllers"
        description="Provision, assign and configure telemetry controllers, connectivity, reporting and prepaid data controls."
        title="Telemetry devices"
      >
        <TelemetryDevicesWorkspace />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
