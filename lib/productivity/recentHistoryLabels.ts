export type RecentRecordKind =
  | 'service-job'
  | 'delivery-order'
  | 'customer'
  | 'machine'
  | 'work-item'
  | 'stock-item';

export type RecentRecordTarget = {
  kind: RecentRecordKind;
  id: string;
};

function cleanIdentifier(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function recentRecordTarget(pathname: string, search = ''): RecentRecordTarget | null {
  const query = new URLSearchParams(search);

  if (pathname === '/operations/service-jobs') {
    const id = cleanIdentifier(query.get('job'));
    if (id) return { kind: 'service-job', id };
  }

  if (pathname === '/operations/deliveries') {
    const id = cleanIdentifier(query.get('order'));
    if (id) return { kind: 'delivery-order', id };
  }

  const machineQuery = cleanIdentifier(query.get('machine'));
  if (machineQuery) return { kind: 'machine', id: machineQuery };

  const customerQuery = cleanIdentifier(query.get('customer'));
  if (customerQuery) return { kind: 'customer', id: customerQuery };

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 2 && segments[0] === 'customers') {
    const id = cleanIdentifier(segments[1]);
    if (id) return { kind: 'customer', id };
  }

  if (segments.length === 3 && segments[0] === 'operations' && segments[1] === 'assets') {
    const id = cleanIdentifier(segments[2]);
    if (id && !['lifecycle', 'scan'].includes(id)) return { kind: 'machine', id };
  }

  if (segments.length === 2 && segments[0] === 'work') {
    const id = cleanIdentifier(segments[1]);
    if (id && !['execution', 'messages'].includes(id)) return { kind: 'work-item', id };
  }

  if (segments.length === 3 && segments[0] === 'warehouse' && segments[1] === 'stock') {
    const id = cleanIdentifier(segments[2]);
    if (id && id !== 'scan') return { kind: 'stock-item', id };
  }

  return null;
}

export function recentHistoryDisplayLabel(activeTitle: string, resolvedRecordLabel?: string | null) {
  const title = activeTitle.trim() || 'Record';
  const recordLabel = resolvedRecordLabel?.trim();
  return recordLabel ? `${title} · ${recordLabel}` : title;
}
