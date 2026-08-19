export type NavigationIconKind =
  | 'dashboard'
  | 'clipboard'
  | 'message'
  | 'bell'
  | 'users'
  | 'tool'
  | 'box'
  | 'chart'
  | 'settings'
  | 'truck'
  | 'search'
  | 'sales'
  | 'finance'
  | 'marketing'
  | 'telemetry'
  | 'scan'
  | 'queue'
  | 'menu'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'pin'
  | 'pin-filled'
  | 'grid';

export function navigationIconKind(label: string, href: string): NavigationIconKind {
  const value = `${label} ${href}`.toLowerCase();
  if (href === '/' || value.includes('dashboard') || value.includes('today') || value.includes('home') || value.includes('command centre')) return 'dashboard';
  if (href === '/map' || value.includes('machine map') || value.includes('location')) return 'pin';
  if (href === '/work' || value.includes('my work') || value.includes('work order') || value.includes('service job') || value.includes('job') || value.includes('task')) return 'clipboard';
  if (value.includes('message') || value.includes('inbox') || value.includes('communication')) return 'message';
  if (value.includes('alert') || value.includes('notification') || value.includes('exception')) return 'bell';
  if (value.includes('customer') || value.includes('user') || value.includes('employee')) return 'users';
  if (value.includes('asset') || value.includes('machine') || value.includes('equipment')) return 'tool';
  if (value.includes('stock') || value.includes('inventory') || value.includes('warehouse') || value.includes('part')) return 'box';
  if (value.includes('telemetry')) return 'telemetry';
  if (value.includes('sales')) return 'sales';
  if (value.includes('finance')) return 'finance';
  if (value.includes('marketing')) return 'marketing';
  if (value.includes('report') || value.includes('executive') || value.includes('overview')) return 'chart';
  if (value.includes('setting') || value.includes('admin') || value.includes('role')) return 'settings';
  if (value.includes('dispatch') || value.includes('delivery') || value.includes('route')) return 'truck';
  if (value.includes('search')) return 'search';
  if (value.includes('scan')) return 'scan';
  return 'grid';
}

export function NavigationIcon({ kind }: { kind: NavigationIconKind }) {
  const common = {
    'aria-hidden': true,
    fill: 'none',
    focusable: false,
    height: '1em',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
    width: '1em',
  };

  switch (kind) {
    case 'dashboard':
      return <svg {...common}><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/></svg>;
    case 'clipboard':
      return <svg {...common}><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2"/><path d="m8.5 13 2.2 2.2 4.8-5"/></svg>;
    case 'message':
      return <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.5-4.5A7 7 0 0 1 3 13V9a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v6Z"/><path d="M8 11h8M8 15h5"/></svg>;
    case 'bell':
      return <svg {...common}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>;
    case 'users':
      return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 15.5A5 5 0 0 1 21 20"/></svg>;
    case 'tool':
      return <svg {...common}><path d="M14.5 6.5a4 4 0 0 0-5 5L3 18l3 3 6.5-6.5a4 4 0 0 0 5-5L15 12l-3-3 2.5-2.5Z"/></svg>;
    case 'box':
      return <svg {...common}><path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z"/><path d="M12 11v10"/></svg>;
    case 'chart':
      return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>;
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.8-1.9.9-1.9-2.1-2.1-1.9.9-1.9-.8-.7-2h-3l-.7 2-1.9.8L3 3.9.9 6l.9 1.9L1 9.8l-2 .7v3l2 .7.8 1.9L.9 18 3 20.1l1.9-.9 1.9.8.7 2h3l.7-2 1.9-.8 1.9.9L18 18l-.9-1.9.8-1.9 2-.7Z" transform="translate(2 0) scale(.83)"/></svg>;
    case 'truck':
      return <svg {...common}><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
    case 'sales':
      return <svg {...common}><path d="M4 18 10 12l4 3 6-8"/><path d="M15 7h5v5"/></svg>;
    case 'finance':
      return <svg {...common}><path d="M12 3v18M16 7.5c0-1.7-1.8-3-4-3s-4 1.2-4 3 1.6 2.6 4 3.1 4 1.4 4 3.4-1.8 3.5-4 3.5-4-1.3-4-3"/></svg>;
    case 'marketing':
      return <svg {...common}><path d="M4 13h3l10 5V6L7 11H4z"/><path d="M7 13v6h3l1-4"/></svg>;
    case 'telemetry':
      return <svg {...common}><path d="M4 17h2M9 14h2M14 10h2M19 6h1"/><path d="M5 17c4-1 7-4 9-7 2-3 4-4 6-4"/></svg>;
    case 'scan':
      return <svg {...common}><path d="M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M8 21H4a1 1 0 0 1-1-1v-4M16 21h4a1 1 0 0 0 1-1v-4"/><path d="M7 12h10"/></svg>;
    case 'queue':
      return <svg {...common}><path d="M5 7h14M5 12h10M5 17h6"/><path d="m16 15 3 3 3-3"/></svg>;
    case 'menu':
      return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
    case 'close':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
    case 'chevron-left':
      return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
    case 'chevron-right':
      return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
    case 'pin':
      return <svg {...common}><path d="m12 3 2.3 4.7L19.5 9l-3.8 3.7.9 5.3-4.6-2.5L7.4 18l.9-5.3L4.5 9l5.2-1.3L12 3Z"/></svg>;
    case 'pin-filled':
      return <svg {...common} fill="currentColor" stroke="currentColor"><path d="m12 3 2.3 4.7L19.5 9l-3.8 3.7.9 5.3-4.6-2.5L7.4 18l.9-5.3L4.5 9l5.2-1.3L12 3Z"/></svg>;
    default:
      return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>;
  }
}
