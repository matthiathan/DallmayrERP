import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { InternalMessagingWorkspace } from '@/components/features/InternalMessagingWorkspace';
import './messaging-layout.css';
import './messaging-mobile-polish.css';

export default function WorkMessagesPage() {
  if (process.env.NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED !== 'true') notFound();

  return (
    <AppShell>
      <InternalMessagingWorkspace />
    </AppShell>
  );
}
