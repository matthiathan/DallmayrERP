import { AppShell } from '@/components/layout/AppShell';
import { ArchiveWorkspace } from '@/components/telemetry-platform/ArchiveWorkspace';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function ArchivePage() {
  return <AppShell><LiveDataStatus refreshIntervalMs={30_000} /><ArchiveWorkspace /></AppShell>;
}
