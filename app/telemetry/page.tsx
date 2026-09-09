import { AppShell } from '@/components/layout/AppShell';
import { TelemetryAnalytics } from '@/components/telemetry-platform/TelemetryAnalytics';

export default function TelemetryPage() {
  return (
    <AppShell>
      <TelemetryAnalytics />
    </AppShell>
  );
}
