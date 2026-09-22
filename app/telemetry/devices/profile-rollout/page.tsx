import { TelemetryDeviceContextLinks } from '@/components/features/TelemetryDeviceContextLinks';
import { AppShell } from '@/components/layout/AppShell';
import { ProfileRolloutWorkspace } from '@/components/telemetry-platform/ProfileRolloutWorkspace';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function ProfileRolloutPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="Fleet rollout"
        description="Track automatic decoder identification, pending acknowledgements and machines that require identity evidence or operator review."
        title="Decoder profile rollout"
      >
        <LiveDataStatus refreshIntervalMs={15_000} />
        <TelemetryDeviceContextLinks />
        <ProfileRolloutWorkspace />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
