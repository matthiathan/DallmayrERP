import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { InternalMessagingWorkspace } from '@/components/features/InternalMessagingWorkspace';
import { INTERNAL_MESSAGING_ENABLED } from '@/lib/features/internalMessaging';
import './messaging-layout.css';

export default function WorkMessagesPage() {
  if (!INTERNAL_MESSAGING_ENABLED) notFound();

  return (
    <AppShell>
      <InternalMessagingWorkspace />
    </AppShell>
  );
}
