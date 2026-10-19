import { AppShell } from '@/components/layout/AppShell';
import { TechnicianFieldWorkspace } from '@/components/telemetry-platform/TechnicianFieldWorkspace';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function TechnicianPage() {
  return <AppShell><LiveDataStatus refreshIntervalMs={30_000} /><TechnicianFieldWorkspace /></AppShell>;
}
