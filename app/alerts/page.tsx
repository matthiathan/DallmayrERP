import { MachineTelemetryOverview } from '@/components/features/MachineTelemetryOverview';
import { AppShell } from '@/components/layout/AppShell';

export default function AlertsPage() {
  return (
    <AppShell>
      <MachineTelemetryOverview initialStatus="fault" />
    </AppShell>
  );
}
