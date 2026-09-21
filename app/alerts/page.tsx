import { AppShell } from '@/components/layout/AppShell';
import { AlarmCenter } from '@/components/telemetry-platform/AlarmCenter';
import { DeviceAttentionPanel } from '@/components/telemetry-platform/DeviceAttentionPanel';
import { FaultIntelligencePanel } from '@/components/telemetry-platform/FaultIntelligencePanel';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function AlertsPage() {
  return (
    <AppShell>
      <LiveDataStatus refreshIntervalMs={30_000} />
      <DeviceAttentionPanel />
      <FaultIntelligencePanel management />
      <AlarmCenter />
    </AppShell>
  );
}
