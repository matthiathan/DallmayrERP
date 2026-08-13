'use client';

import Link from 'next/link';
import { isPast, type NormalizedMyWorkItem } from '@/components/features/mondayMyWorkNormalization';
import type { Density } from '@/components/features/useMondayMyWorkPreferences';
import { StatusBadge } from '@/components/ui/StatusBadge';

function formatDateTime(value: string | null) {
  if (!value) return 'No target date';
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function MondayMyWorkCard({ item, density }: { item: NormalizedMyWorkItem; density: Density }) {
  return (
    <Link className={`monday-my-work-card is-${density}`} href={item.href}>
      <div className="monday-my-work-card-heading">
        <div>
          <span>{item.sourceLabel}</span>
          <strong>{item.title}</strong>
        </div>
        <StatusBadge value={item.status} />
      </div>
      <p>{item.description}</p>
      <div className="monday-my-work-card-meta">
        <span>{item.subtitle}</span>
        <span>{item.branch.toUpperCase()}</span>
        <span>{formatDateTime(item.dueAt)}</span>
      </div>
      <div className="monday-my-work-card-badges">
        <StatusBadge value={item.priority} />
        {item.approvalPending ? <StatusBadge value="pending approval" /> : null}
        {item.isOpen && isPast(item.dueAt) ? <StatusBadge value="overdue" /> : null}
      </div>
    </Link>
  );
}
