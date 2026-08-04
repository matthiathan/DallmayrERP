import { InternalMessagingWorkspace } from '@/components/features/InternalMessagingWorkspace';
import { AppShell } from '@/components/layout/AppShell';

export default function MessagesPage() {
  return (
    <AppShell>
      <InternalMessagingWorkspace />
    </AppShell>
  );
}
