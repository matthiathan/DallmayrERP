import { AppShell } from '@/components/layout/AppShell';
import { InventoryPlanningBoard } from '@/components/features/InventoryPlanningBoard';

export default function InventoryPlanningPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Warehouse</div>
          <h1>Inventory Planning</h1>
          <p>Exception-based replenishment, stock-out risk, excess stock and branch redistribution planning.</p>
        </div>
      </div>
      <InventoryPlanningBoard />
    </AppShell>
  );
}
