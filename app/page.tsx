import { AppShell } from '@/components/layout/AppShell';
import { TelevendFleetDashboard } from '@/components/telemetry-platform/TelevendFleetDashboard';

export default function DashboardPage() {
  return (
    <AppShell>
      <TelevendFleetDashboard />
    </AppShell>
  );
}
