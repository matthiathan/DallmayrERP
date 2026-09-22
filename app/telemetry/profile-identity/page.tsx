import { AppShell } from '@/components/layout/AppShell';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';
import { ProfileIdentityEvidenceWorkspace } from '@/components/telemetry-platform/ProfileIdentityEvidenceWorkspace';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function ProfileIdentityPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="Decoder learning"
        description="Review machine identity observations and promote verified fingerprints or model aliases into reusable automatic decoder rules."
        title="Profile identity"
      >
        <LiveDataStatus refreshIntervalMs={15_000} />
        <ProfileIdentityEvidenceWorkspace />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
