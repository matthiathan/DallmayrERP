export type ConnectedRecordKind = 'customer' | 'machine' | 'work' | 'service' | 'delivery' | 'stock';

export type ConnectedRecordRequest = {
  kind: ConnectedRecordKind;
  id: string;
};

function decodeSegment(value: string | null | undefined) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getConnectedRecordRequest(pathname: string, search = ''): ConnectedRecordRequest | null {
  const customerMatch = pathname.match(/^\/customers\/([^/]+)$/);
  if (customerMatch) return { kind: 'customer', id: decodeSegment(customerMatch[1]) ?? customerMatch[1] };

  const machineMatch = pathname.match(/^\/operations\/assets\/([^/]+)$/);
  if (machineMatch && machineMatch[1] !== 'lifecycle' && machineMatch[1] !== 'scan') {
    return { kind: 'machine', id: decodeSegment(machineMatch[1]) ?? machineMatch[1] };
  }

  const workMatch = pathname.match(/^\/work\/([^/]+)$/);
  if (workMatch && workMatch[1] !== 'execution' && workMatch[1] !== 'messages') {
    return { kind: 'work', id: decodeSegment(workMatch[1]) ?? workMatch[1] };
  }

  const stockMatch = pathname.match(/^\/warehouse\/stock\/([^/]+)$/);
  if (stockMatch && stockMatch[1] !== 'scan') {
    return { kind: 'stock', id: decodeSegment(stockMatch[1]) ?? stockMatch[1] };
  }

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (pathname === '/operations/service-jobs') {
    const id = decodeSegment(params.get('job'));
    return id ? { kind: 'service', id } : null;
  }
  if (pathname === '/operations/deliveries') {
    const id = decodeSegment(params.get('order'));
    return id ? { kind: 'delivery', id } : null;
  }

  return null;
}

export function connectedRecordHref(kind: ConnectedRecordKind, id: string) {
  const encoded = encodeURIComponent(id);
  switch (kind) {
    case 'customer': return `/customers/${encoded}`;
    case 'machine': return `/operations/assets/${encoded}`;
    case 'work': return `/work/${encoded}`;
    case 'service': return `/operations/service-jobs?job=${encoded}`;
    case 'delivery': return `/operations/deliveries?order=${encoded}`;
    case 'stock': return `/warehouse/stock/${encoded}`;
  }
}

export function pathnameFromConnectedHref(href: string) {
  const queryIndex = href.indexOf('?');
  return queryIndex === -1 ? href : href.slice(0, queryIndex);
}

export function isTerminalConnectedStatus(status: string | null | undefined) {
  return ['completed', 'verified', 'closed', 'cancelled', 'delivered', 'received', 'rejected'].includes(status ?? '');
}
