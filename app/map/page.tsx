import { TelemetryLocationMap } from '@/components/features/TelemetryLocationMap';
import { AppShell } from '@/components/layout/AppShell';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';

export default function MachineMapPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="OpenFreeMap · OpenStreetMap"
        description="Live machine locations, connection state and movement across the fleet."
        title="Fleet map"
      >
        <TelemetryLocationMap />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
