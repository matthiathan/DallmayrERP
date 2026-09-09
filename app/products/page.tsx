import { ProductMappingWorkspace } from '@/components/features/ProductMappingWorkspace';
import { AppShell } from '@/components/layout/AppShell';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';

export default function ProductsPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="Fleet product mapping"
        description="Map machine buttons and telemetry selections to Dallmayr product names."
        title="Products"
      >
        <ProductMappingWorkspace />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
