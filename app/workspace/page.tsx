import { RoleWorkspacePanel } from '@/components/features/RoleWorkspacePanel';
import { AppShell } from '@/components/layout/AppShell';

export default function WorkspacePage() {
  return (
    <AppShell>
      <div className="minimal-page-header">
        <span className="minimal-kicker">My workspace</span>
        <h1>Today in DallmayrERP</h1>
        <p>Focused shortcuts, live counts and role-specific work priorities.</p>
      </div>
      <RoleWorkspacePanel />
    </AppShell>
  );
}
