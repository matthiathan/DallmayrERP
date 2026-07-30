import Link from 'next/link';
import { RoleTodayWorkspace } from '@/components/features/RoleTodayWorkspace';
import { AppShell } from '@/components/layout/AppShell';

export default function WorkspacePage() {
  return (
    <AppShell>
      <section className="shared-dashboard-shortcut" aria-label="Shared role dashboard">
        <div>
          <span>Published workspace</span>
          <strong>Shared role dashboard</strong>
          <p>Open the administrator-published metrics for your role and branch scope.</p>
        </div>
        <Link className="button secondary" href="/workspace/dashboards">Open dashboard</Link>
      </section>
      <RoleTodayWorkspace />
    </AppShell>
  );
}
