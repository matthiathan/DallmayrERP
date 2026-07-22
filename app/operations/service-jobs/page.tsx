import { Suspense } from 'react';
import { EnterpriseServiceJobBoard } from '@/components/features/EnterpriseServiceJobBoard';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsServiceJobsPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Operations</div>
          <h1>Scheduled Call Log</h1>
          <p>Create complete customer service incidents, assign technicians, track follow-ups and control verified closure.</p>
        </div>
      </div>
      <Suspense fallback={<div className="neo-card"><h2>Loading service call log...</h2></div>}>
        <EnterpriseServiceJobBoard />
      </Suspense>
    </AppShell>
  );
}
