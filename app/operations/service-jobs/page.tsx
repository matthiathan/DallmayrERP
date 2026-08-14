import { Suspense } from 'react';
import { EnterpriseServiceJobBoard } from '@/components/features/EnterpriseServiceJobBoard';
import { AppShell } from '@/components/layout/AppShell';
import { PageNavigationMetadata, PageSectionAnchor } from '@/components/layout/PageNavigationMetadata';

const SERVICE_JOB_NAVIGATION = {
  title: 'Scheduled Call Log',
  sections: [
    { id: 'service-job-overview', label: 'Overview' },
    { id: 'service-job-workspace', label: 'Service workspace' },
  ],
} as const;

export default function OperationsServiceJobsPage() {
  return (
    <AppShell>
      <PageNavigationMetadata metadata={SERVICE_JOB_NAVIGATION} />
      <div className="page-header hero-panel spatial-card" id="service-job-overview">
        <div>
          <div className="badge">Operations</div>
          <h1>Scheduled Call Log</h1>
          <p>View service incidents, assign technicians, track follow-ups and control verified closure. Recurring plans are created under Preventive Maintenance.</p>
        </div>
      </div>
      <PageSectionAnchor id="service-job-workspace" />
      <Suspense fallback={<div className="neo-card"><h2>Loading service call log...</h2></div>}>
        <EnterpriseServiceJobBoard />
      </Suspense>
    </AppShell>
  );
}
