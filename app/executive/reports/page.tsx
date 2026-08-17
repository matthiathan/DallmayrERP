import { ExecutiveReportingPanel } from '@/components/features/ExecutiveReportingPanel';
import { AppShell } from '@/components/layout/AppShell';
import { ErpPage, ErpPageHeader } from '@/components/ui/ErpLayout';

export default function ExecutiveReportsPage() {
  return (
    <AppShell>
      <ErpPage variant="dashboard">
        <ErpPageHeader
          description="Board-level management packs, configurable KPIs, trends and saved reporting schedules."
          eyebrow="Insights"
          title="Executive Reports"
        />
        <ExecutiveReportingPanel />
      </ErpPage>
    </AppShell>
  );
}
