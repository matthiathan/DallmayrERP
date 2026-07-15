type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'purple';

const statusTones: Record<string, StatusTone> = {
  new: 'info',
  draft: 'neutral',
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
};

function formatStatus(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function StatusBadge({ value, label, tone }: { value: string; label?: string; tone?: StatusTone }) {
  const normalized = value.toLowerCase();
  const resolvedTone = tone ?? statusTones[normalized] ?? 'neutral';

  return <span className={`status-badge status-${resolvedTone}`}>{label ?? formatStatus(value)}</span>;
}
