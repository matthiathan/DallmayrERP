import { PurchaseApprovalPanel } from '@/components/features/PurchaseApprovalPanel';
import { AppShell } from '@/components/layout/AppShell';

export default function PurchaseApprovalPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Purchasing control</div>
          <h1>Purchase Approvals</h1>
          <p>Review spend, convert low-stock suggestions into draft orders and enforce approval before ordering.</p>
        </div>
      </div>
      <PurchaseApprovalPanel />
    </AppShell>
  );
}
