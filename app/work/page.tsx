import { ProfessionalActionCentre } from '@/components/features/ProfessionalActionCentre';
import { AppShell } from '@/components/layout/AppShell';

export default function WorkActionCentrePage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Professional operations</div>
          <h1>Action Centre</h1>
          <p>One structured queue for tasks, approvals, service exceptions, stock alerts, purchasing, deliveries and asset audits.</p>
        </div>
      </div>
      <ProfessionalActionCentre />
    </AppShell>
  );
}
