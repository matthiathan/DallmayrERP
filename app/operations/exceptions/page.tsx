import { OperationsExceptionCentre } from '@/components/features/OperationsExceptionCentre';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsExceptionsPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card exception-centre-hero">
        <div>
          <div className="badge">Operations control</div>
          <h1>Exception Centre</h1>
          <p>Acknowledge, assign, snooze, escalate and resolve operational exceptions while keeping every action auditable.</p>
        </div>
      </div>
      <OperationsExceptionCentre />
    </AppShell>
  );
}
