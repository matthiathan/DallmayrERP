import { AppShell } from '@/components/layout/AppShell';
import { AlarmCenter } from '@/components/telemetry-platform/AlarmCenter';
import { DeviceAttentionPanel } from '@/components/telemetry-platform/DeviceAttentionPanel';
import { FaultIntelligencePanel } from '@/components/telemetry-platform/FaultIntelligencePanel';

export default function AlertsPage() {
  return (
    <AppShell>
      <DeviceAttentionPanel />
      <FaultIntelligencePanel management />
      <AlarmCenter />
    </AppShell>
  );
}
