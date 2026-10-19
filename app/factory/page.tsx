import { AppShell } from '@/components/layout/AppShell';
import { FactoryWorkspace } from '@/components/telemetry-platform/FactoryWorkspace';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function FactoryPage() {
  return <AppShell><LiveDataStatus refreshIntervalMs={30_000} /><FactoryWorkspace /></AppShell>;
}
