import { AppShell } from '@/components/layout/AppShell';
import { MachineDetail } from '@/components/telemetry-platform/MachineDetail';

export default async function MachineDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <MachineDetail machineId={id} />
    </AppShell>
  );
}
