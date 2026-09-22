import { TelemetryFieldAcceptance } from '@/components/features/TelemetryFieldAcceptance';
import { TelemetryFieldAcceptanceRecord } from '@/components/features/TelemetryFieldAcceptanceRecord';
import { TestCenterWorkspaceOrganizer } from '@/components/features/TestCenterWorkspaceOrganizer';
import { AppShell } from '@/components/layout/AppShell';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';

export default function TelemetryTestCenterPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="Remote diagnostics"
        description="Commission telemetry devices, inspect important events, run safe commands and review archived diagnostic sessions."
        title="Test Center"
      >
        <TelemetryFieldAcceptance />
        <TelemetryFieldAcceptanceRecord />
        <TestCenterWorkspaceOrganizer />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
