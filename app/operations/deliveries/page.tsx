import { DeliveryStatusBoard } from '@/components/features/DeliveryStatusBoard';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsDeliveriesPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Operations</div>
          <h1>Delivery Board</h1>
          <p>Track delivery orders through their operating states.</p>
        </div>
      </div>
      <DeliveryStatusBoard />
    </AppShell>
  );
}
