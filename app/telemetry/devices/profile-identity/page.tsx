import { TelemetryDeviceContextLinks } from '@/components/features/TelemetryDeviceContextLinks';
import { AppShell } from '@/components/layout/AppShell';
import { ProfileIdentityEvidenceWorkspace } from '@/components/telemetry-platform/ProfileIdentityEvidenceWorkspace';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function ProfileIdentityEvidencePage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="Decoder learning"
        description="Review machine identity observations and promote field-confirmed fingerprints or model aliases into trusted automatic decoder evidence."
        title="Profile identity evidence"
      >
        <LiveDataStatus refreshIntervalMs={15_000} />
        <TelemetryDeviceContextLinks />
        <ProfileIdentityEvidenceWorkspace />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
