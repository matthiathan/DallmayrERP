type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'purple';

const statusTones: Record<string, StatusTone> = {
  new: 'info',
  draft: 'neutral',
  ordered: 'info',
  part_received: 'warning',
  received: 'success',
  purchase_received: 'success',
  assigned: 'purple',
  picked: 'purple',
  in_progress: 'warning',
  dispatched: 'warning',
  active: 'success',
  completed: 'success',
  delivered: 'success',
  verified: 'success',
  closed: 'neutral',
  inactive: 'neutral',
  unknown: 'neutral',
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
  repair: 'warning',
  retired: 'neutral',
  cancelled: 'danger',
  overdue: 'danger',
  low_stock: 'warning',
  out_of_stock: 'danger',
  issued: 'warning',
  adjustment_in: 'info',
  adjustment_out: 'danger',
  adjusted: 'warning',
  returned: 'success',
  transferred: 'purple',
  transfer_in: 'success',
  transfer_out: 'purple',
  cycle_count: 'info',
};

function formatStatus(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function StatusBadge({ value, label, tone }: { value: string; label?: string; tone?: StatusTone }) {
  const normalized = value.toLowerCase();
  const resolvedTone = tone ?? statusTones[normalized] ?? 'neutral';

  return <span className={`status-badge status-${resolvedTone}`}>{label ?? formatStatus(value)}</span>;
}
