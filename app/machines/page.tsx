import { AppShell } from '@/components/layout/AppShell';
import { MachineFleetBrowser } from '@/components/telemetry-platform/MachineFleetBrowser';

export default function MachinesPage() {
  return (
    <AppShell>
      <MachineFleetBrowser />
    </AppShell>
  );
}
