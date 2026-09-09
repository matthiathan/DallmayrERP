import { AppShell } from '@/components/layout/AppShell';
import { TelemetryTestCenter } from '@/components/features/TelemetryTestCenter';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';

export default function TelemetryTestCenterPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="Remote diagnostics"
        description="Commission telemetry devices, inspect live machine communications and run temporary remote diagnostic sessions."
        title="Test Center"
      >
        <TelemetryTestCenter />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
