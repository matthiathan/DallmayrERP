import { WorkExecutionWorkspace } from '@/components/features/WorkExecutionWorkspace';
import { AppShell } from '@/components/layout/AppShell';

export default function WorkExecutionPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Field execution</div>
          <h1>Work Execution</h1>
          <p>Run checklists, record time and parts, and capture completion evidence from one compact workspace.</p>
        </div>
      </div>
      <WorkExecutionWorkspace />
    </AppShell>
  );
}
