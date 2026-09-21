import { ProductsWorkspaceOrganizer } from '@/components/features/ProductsWorkspaceOrganizer';
import { AppShell } from '@/components/layout/AppShell';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';

export default function ProductsPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="Fleet product mapping"
        description="Maintain the product catalogue, map machine selections, resolve unmapped telemetry and review mapping history."
        title="Products"
      >
        <ProductsWorkspaceOrganizer />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
