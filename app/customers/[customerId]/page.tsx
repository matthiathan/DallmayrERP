import { AppShell } from '@/components/layout/AppShell';
import { CustomerSitesWorkspace } from '@/components/telemetry-platform/CustomerSitesWorkspace';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default async function CustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  return <AppShell><LiveDataStatus refreshIntervalMs={30_000} /><CustomerSitesWorkspace customerId={customerId} /></AppShell>;
}
