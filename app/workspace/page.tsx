import Link from 'next/link';
import { RoleTodayWorkspace } from '@/components/features/RoleTodayWorkspace';
import { AppShell } from '@/components/layout/AppShell';
import { ErpPanel } from '@/components/ui/ErpLayout';

export default function WorkspacePage() {
  return (
    <AppShell>
      <RoleTodayWorkspace />
      <ErpPanel
        actions={<Link className="button secondary" href="/workspace/dashboards">Open shared dashboards</Link>}
        description="Open administrator-published metric views for your role and branch. Shared dashboards use the same authorised ERP data scope as your normal workspace."
        eyebrow="Published views"
        title="Shared dashboards"
      >
        <p>Your standard Today workspace remains your default landing page. Personal dashboard ordering and saved views will be added separately.</p>
      </ErpPanel>
    </AppShell>
  );
}
