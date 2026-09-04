import { MachineDashboard } from '@/components/features/MachineDashboard';
import { AppShell } from '@/components/layout/AppShell';

export default async function MachineDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <AppShell>
      <MachineDashboard machineId={id} />
    </AppShell>
  );
}
