import { AdminUserAccessControl } from '@/components/features/AdminUserAccessControl';
import { ClientAccessControl } from '@/components/features/ClientAccessControl';
import { AppShell } from '@/components/layout/AppShell';
import { SpecialistWorkspaceFrame } from '@/components/telemetry-platform/SpecialistWorkspaceFrame';

export default function UsersPage() {
  return (
    <AppShell>
      <SpecialistWorkspaceFrame
        badge="Dallmayr administrators"
        description="Create Dallmayr staff access and customer-scoped client logins. Client accounts are read-only and restricted to telemetry for their assigned company."
        title="Users & client access"
      >
        <ClientAccessControl />
        <AdminUserAccessControl />
      </SpecialistWorkspaceFrame>
    </AppShell>
  );
}
