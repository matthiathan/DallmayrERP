import { AppShell } from '@/components/layout/AppShell';
import { FaultIntelligencePanel } from '@/components/telemetry-platform/FaultIntelligencePanel';
import { MachineDetail } from '@/components/telemetry-platform/MachineDetail';
import { MachineOperationsSnapshot } from '@/components/telemetry-platform/MachineOperationsSnapshot';
import { MachineTelemetryRegionControl } from '@/components/telemetry-platform/MachineTelemetryRegionControl';
import { MachineVendReconciliationPanel } from '@/components/telemetry-platform/MachineVendReconciliationPanel';

export default async function MachineDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <MachineDetail machineId={id} />
      <MachineOperationsSnapshot machineId={id} />
      <MachineTelemetryRegionControl machineId={id} />
      <FaultIntelligencePanel machineId={id} />
      <MachineVendReconciliationPanel machineId={id} />
    </AppShell>
  );
}
