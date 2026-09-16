import { AppShell } from '@/components/layout/AppShell';
import { TelemetryAiInsights } from '@/components/telemetry-platform/TelemetryAiInsights';
import { TelevendFleetDashboard } from '@/components/telemetry-platform/TelevendFleetDashboard';

export default function DashboardPage() {
  return (
    <AppShell>
      <TelemetryAiInsights />
      <TelevendFleetDashboard />
    </AppShell>
  );
}
