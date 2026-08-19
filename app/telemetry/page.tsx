import { TelemetryDashboard } from '@/components/features/TelemetryDashboard';
import { AppShell } from '@/components/layout/AppShell';

export default function TelemetryPage() {
  return (
    <AppShell>
      <TelemetryDashboard />
    </AppShell>
  );
}
