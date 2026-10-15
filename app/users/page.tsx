import { AppShell } from '@/components/layout/AppShell';
import { AdministrationWorkspace } from '@/components/telemetry-platform/AdministrationWorkspace';

export default function UsersPage() {
  return <AppShell><AdministrationWorkspace initialTab="users" /></AppShell>;
}
