import { FleetAlertPulse } from '@/components/features/FleetAlertPulse';
import { MachineTelemetryOverview } from '@/components/features/MachineTelemetryOverview';
import { AppShell } from '@/components/layout/AppShell';

export default function AlertsPage() {
  return (
    <AppShell>
      <div className="alerts-visual-route">
        <FleetAlertPulse />
        <MachineTelemetryOverview initialStatus="fault" />
      </div>
    </AppShell>
  );
}
