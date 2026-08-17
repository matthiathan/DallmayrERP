import { Suspense } from 'react';
import { EnterpriseServiceJobBoard } from '@/components/features/EnterpriseServiceJobBoard';
import { AppShell } from '@/components/layout/AppShell';
import { PageNavigationMetadata, PageSectionAnchor } from '@/components/layout/PageNavigationMetadata';
import { ErpPage, ErpPageHeader, ErpStateBanner } from '@/components/ui/ErpLayout';

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
      <ErpPage variant="operational">
        <ErpPageHeader
          description="View service incidents, assign technicians, track follow-ups and control verified closure. Recurring plans are created under Preventive Maintenance."
          eyebrow="Operations"
          id="service-job-overview"
          title="Scheduled Call Log"
        />
        <PageSectionAnchor id="service-job-workspace" />
        <Suspense fallback={<ErpStateBanner message="Preparing service incidents and assignment controls." title="Loading service call log" />}>
          <EnterpriseServiceJobBoard />
        </Suspense>
      </ErpPage>
    </AppShell>
  );
}
