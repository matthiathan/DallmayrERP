import { AppShell } from '@/components/layout/AppShell';
import { CustomerSitesWorkspace } from '@/components/telemetry-platform/CustomerSitesWorkspace';
import { LiveDataStatus } from '@/components/ui/LiveDataStatus';

export default function CustomersPage() {
  return <AppShell><LiveDataStatus refreshIntervalMs={30_000} /><CustomerSitesWorkspace /></AppShell>;
}
