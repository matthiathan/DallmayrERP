import { FleetDataUsagePanel } from '@/components/features/FleetDataUsagePanel';
import { FleetVisualCommandCenter } from '@/components/features/FleetVisualCommandCenter';
import { AppShell } from '@/components/layout/AppShell';

export default function DashboardPage() {
  return (
    <AppShell>
      <FleetVisualCommandCenter />
      <FleetDataUsagePanel />
    </AppShell>
  );
}
