import { AppShell } from '@/components/layout/AppShell';
import { TelevendFleetDashboard } from '@/components/telemetry-platform/TelevendFleetDashboard';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function DashboardPage() {
  return (
    <AppShell>
      <LiveDataStatus refreshIntervalMs={30_000} />
      <TelevendFleetDashboard />
    </AppShell>
  );
}
