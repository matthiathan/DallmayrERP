import { AppShell } from '@/components/layout/AppShell';
import { AlarmCenter } from '@/components/telemetry-platform/AlarmCenter';

export default function AlertsPage() {
  return (
    <AppShell>
      <AlarmCenter />
    </AppShell>
  );
}
