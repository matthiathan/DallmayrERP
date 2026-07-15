import { Suspense } from 'react';
import { EnterpriseServiceJobBoard } from '@/components/features/EnterpriseServiceJobBoard';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsServiceJobsPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Operations</div>
          <h1>Service Jobs</h1>
          <p>Create, prioritise, assign and manage customer-linked service work across branches and technicians.</p>
        </div>
      </div>
      <Suspense fallback={<div className="neo-card"><h2>Loading service dispatch...</h2></div>}>
        <EnterpriseServiceJobBoard />
      </Suspense>
    </AppShell>
  );
}
