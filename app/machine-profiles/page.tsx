import { AppShell } from '@/components/layout/AppShell';
import { MachineProfilesWorkspace } from '@/components/telemetry-platform/MachineProfilesWorkspace';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function MachineProfilesPage() {
  return <AppShell><LiveDataStatus refreshIntervalMs={30_000} /><MachineProfilesWorkspace /></AppShell>;
}
