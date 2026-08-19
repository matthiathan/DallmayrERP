'use client';

import { useParams } from 'next/navigation';
import { MachineTelemetryOverview } from '@/components/features/MachineTelemetryOverview';
import { AppShell } from '@/components/layout/AppShell';

export default function MachineTelemetryPage() {
  const { machineId } = useParams<{ machineId: string }>();
  return (
    <AppShell>
      <MachineTelemetryOverview initialMachineId={machineId} machinesOnly />
    </AppShell>
  );
}
