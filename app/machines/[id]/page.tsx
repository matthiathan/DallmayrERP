import { MachineCommandCenter } from '@/components/features/MachineCommandCenter';
import { AppShell } from '@/components/layout/AppShell';

export default async function MachineDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <MachineCommandCenter machineId={id} />
    </AppShell>
  );
}
