import { notFound, redirect } from 'next/navigation';
import { INTERNAL_MESSAGING_ENABLED } from '@/lib/features/internalMessaging';

export default function MessagesPage() {
  if (!INTERNAL_MESSAGING_ENABLED) notFound();
  redirect('/work/messages');
}
