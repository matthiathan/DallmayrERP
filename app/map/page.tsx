import { TelemetryLocationMap } from '@/components/features/TelemetryLocationMap';
import { AppShell } from '@/components/layout/AppShell';

export default function MachineMapPage() {
  return (
    <AppShell>
      <TelemetryLocationMap />
    </AppShell>
  );
}
