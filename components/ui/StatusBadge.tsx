type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'purple';

const statusTones: Record<string, StatusTone> = {
  new: 'info',
  triaged: 'info',
  draft: 'neutral',
  ordered: 'info',
  part_received: 'warning',
  received: 'success',
  purchase_received: 'success',
  assigned: 'purple',
  picked: 'purple',
  in_progress: 'warning',
  blocked: 'danger',
  waiting_approval: 'purple',
  pending: 'warning',
  pending_finance_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  paid: 'success',
  unpaid: 'danger',
  refunded: 'neutral',
  waived: 'info',
  not_recorded: 'neutral',
  not_scheduled: 'neutral',
  due: 'warning',
  missed: 'danger',
  rescheduled: 'purple',
  monthly: 'purple',
  on_request: 'info',
  not_required: 'neutral',
  request: 'info',
  task: 'neutral',
  approval: 'purple',
  inspection: 'info',
  maintenance: 'warning',
  incident: 'danger',
  calendar: 'info',
  meter: 'purple',
  hybrid: 'warning',
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
  good: 'success',
  fair: 'info',
  poor: 'warning',
  passed: 'success',
  attention: 'warning',
  failed: 'danger',
  available: 'success',
  checked_out: 'purple',
  checked_in: 'success',
  in_service: 'warning',
  repair: 'warning',
  retired: 'neutral',
  cancelled: 'danger',
  overdue: 'danger',
  warning: 'warning',
  low_stock: 'warning',
  out_of_stock: 'danger',
  lot: 'info',
  serial: 'purple',
  lot_serial: 'warning',
  in_stock: 'success',
  reserved: 'purple',
  quarantined: 'warning',
  expired: 'danger',
  recalled: 'danger',
  depleted: 'neutral',
  damaged: 'danger',
  issued: 'warning',
  adjustment_in: 'info',
  adjustment_out: 'danger',
  adjusted: 'warning',
  returned: 'success',
  transferred: 'purple',
  transfer_in: 'success',
  transfer_out: 'purple',
  cycle_count: 'info',
  created: 'info',
  audited: 'info',
  status_changed: 'purple',
  label_printed: 'neutral',
  work_item_created: 'info',
  work_item_status_changed: 'purple',
  work_item_approval: 'success',
};

function formatStatus(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function StatusBadge({ value, label, tone }: { value: string; label?: string; tone?: StatusTone }) {
  const normalized = value.toLowerCase();
  const resolvedTone = tone ?? statusTones[normalized] ?? 'neutral';

  return (
    <span
      className={`status-badge status-${resolvedTone}`}
      data-tone={resolvedTone}
      data-value={normalized}
    >
      {label ?? formatStatus(value)}
    </span>
  );
}
