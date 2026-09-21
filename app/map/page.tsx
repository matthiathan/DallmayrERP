import { TelemetryLocationWorkspace } from '@/components/features/TelemetryLocationWorkspace';
import { AppShell } from '@/components/layout/AppShell';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function MachineMapPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="OpenFreeMap · OpenStreetMap"
        description="Live machine locations, connection state and movement across the fleet."
        title="Fleet map"
      >
        <LiveDataStatus refreshIntervalMs={30_000} />
        <TelemetryLocationWorkspace />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
