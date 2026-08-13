import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { SecureInternalMessagingWorkspace } from '@/components/features/SecureInternalMessagingWorkspace';
import './messaging-layout.css';
import './messaging-mobile-polish.css';

export default function WorkMessagesPage() {
  if (process.env.NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED !== 'true') notFound();

  return (
    <AppShell>
      <SecureInternalMessagingWorkspace />
    </AppShell>
  );
}
