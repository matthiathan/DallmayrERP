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
        description="Review controller-reported machine identity evidence and promote field-confirmed fingerprints or model aliases into reusable automatic decoder rules."
        title="Profile identity evidence"
      >
        <LiveDataStatus refreshIntervalMs={30_000} />
        <TelemetryDeviceContextLinks />
        <ProfileIdentityEvidenceWorkspace />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
