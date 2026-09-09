import { ProductMappingWorkspace } from '@/components/features/ProductMappingWorkspace';
import { AppShell } from '@/components/layout/AppShell';

export default function ProductsPage() {
  return (
    <AppShell>
      <div className="product-mobile-route">
        <ProductMappingWorkspace />
      </div>
    </AppShell>
  );
}
