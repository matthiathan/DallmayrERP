import { DataMatchingWorkbench } from '@/components/features/DataMatchingWorkbench';
import { AppShell } from '@/components/layout/AppShell';

export default function DataMatchingPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Utilities</div>
          <h1>Data Matching Workbench</h1>
          <p>Clean imported master data, find unlinked machines and review duplicate customer or asset identifiers.</p>
        </div>
      </div>
      <DataMatchingWorkbench />
    </AppShell>
  );
}
