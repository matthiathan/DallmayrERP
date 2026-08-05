import { notFound, redirect } from 'next/navigation';

export default function MessagesPage() {
  if (process.env.NEXT_PUBLIC_INTERNAL_MESSAGING_ENABLED === 'false') notFound();
  redirect('/work/messages');
}
