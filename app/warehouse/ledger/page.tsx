import { InventoryLedgerPanel } from '@/components/features/InventoryLedgerPanel';
import { AppShell } from '@/components/layout/AppShell';

export default function WarehouseLedgerPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Warehouse</div>
          <h1>Inventory Ledger</h1>
          <p>Append-only enterprise stock movement register for received, picked, dispatched, returned and adjusted stock.</p>
        </div>
      </div>
      <InventoryLedgerPanel />
    </AppShell>
  );
}
