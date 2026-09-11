import { AppShell } from '@/components/layout/AppShell';
import { AlarmCenter } from '@/components/telemetry-platform/AlarmCenter';
import { DeviceAttentionPanel } from '@/components/telemetry-platform/DeviceAttentionPanel';

export default function AlertsPage() {
  return (
    <AppShell>
      <DeviceAttentionPanel />
      <AlarmCenter />
    </AppShell>
  );
}
