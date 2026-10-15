import { AppShell } from '@/components/layout/AppShell';
import { MaintenanceWorkspace } from '@/components/telemetry-platform/MaintenanceWorkspace';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function MaintenancePage() {
  return (
    <AppShell>
      <LiveDataStatus refreshIntervalMs={30_000} />
      <MaintenanceWorkspace />
    </AppShell>
  );
}
