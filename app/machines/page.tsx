import { MachineTelemetryOverview } from '@/components/features/MachineTelemetryOverview';
import { AppShell } from '@/components/layout/AppShell';

export default function MachinesPage() {
  return (
    <AppShell>
      <MachineTelemetryOverview machinesOnly />
    </AppShell>
  );
}
