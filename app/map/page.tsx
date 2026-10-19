import { TelemetryLocationWorkspace } from '@/components/features/TelemetryLocationWorkspace';
import { AppShell } from '@/components/layout/AppShell';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function MachineMapPage() {
  return (
    <AppShell>
      <LiveDataStatus refreshIntervalMs={30_000} />
      <TelemetryLocationWorkspace />
    </AppShell>
  );
}
