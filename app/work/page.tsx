import { ProfessionalActionCentre } from '@/components/features/ProfessionalActionCentre';
import { ProfessionalSignalsPanel } from '@/components/features/ProfessionalSignalsPanel';
import { AppShell } from '@/components/layout/AppShell';

export default function WorkActionCentrePage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Professional operations</div>
          <h1>Action Centre</h1>
          <p>One structured queue for tasks, approvals, service exceptions, stock alerts, purchasing, maintenance and asset lifecycle actions.</p>
        </div>
      </div>
      <ProfessionalSignalsPanel />
      <div style={{ height: 14 }} />
      <ProfessionalActionCentre />
    </AppShell>
  );
}
