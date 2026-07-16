import { PurchaseOrderBoard } from '@/components/features/PurchaseOrderBoard';
import { AppShell } from '@/components/layout/AppShell';

export default function WarehousePurchasingPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div><div className="badge">Warehouse purchasing</div><h1>Purchase Orders & Receiving</h1><p>Create supplier orders, scan ordered items and receive partial or complete deliveries directly into stock.</p></div>
      </div>
      <PurchaseOrderBoard />
    </AppShell>
  );
}
