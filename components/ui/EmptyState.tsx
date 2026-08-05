import type { ReactNode } from 'react';
import { UiEmptyState } from '@/components/ui/DesignSystem';

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <UiEmptyState action={action} description={message} title={title} />;
}
