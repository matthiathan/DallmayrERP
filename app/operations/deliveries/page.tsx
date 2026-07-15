import { EnterpriseDeliveryBoard } from '@/components/features/EnterpriseDeliveryBoard';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsDeliveriesPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Operations</div>
          <h1>Delivery Board</h1>
          <p>Track, filter and move delivery orders through controlled operating stages.</p>
        </div>
      </div>
      <EnterpriseDeliveryBoard />
    </AppShell>
  );
}
