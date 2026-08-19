import { MachineTelemetryOverview } from '@/components/features/MachineTelemetryOverview';
import { AppShell } from '@/components/layout/AppShell';

export default function DashboardPage() {
  return (
    <AppShell>
      <MachineTelemetryOverview />
    </AppShell>
  );
}
