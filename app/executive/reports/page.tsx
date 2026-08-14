import { ExecutiveReportingPanel } from '@/components/features/ExecutiveReportingPanel';
import { AppShell } from '@/components/layout/AppShell';

export default function ExecutiveReportsPage() {
  return (
    <AppShell>
      <div className="page-header"><div><h1>Executive Reports</h1><p>Board-level management packs, configurable KPIs, trends and saved reporting schedules.</p></div></div>
      <ExecutiveReportingPanel />
    </AppShell>
  );
}
