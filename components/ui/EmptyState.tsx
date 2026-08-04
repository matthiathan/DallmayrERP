import type { ReactNode } from 'react';

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-icon" aria-hidden="true">-</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action ? <div className="action-row">{action}</div> : null}
    </div>
  );
}
