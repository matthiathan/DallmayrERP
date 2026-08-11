'use client';

import Link from 'next/link';
import type { NavItem, NavSection } from '@/lib/auth/permissions';

type DesktopNavigationRailProps = {
  collapsed: boolean;
  homePath: string;
  onToggleCollapse: () => void;
  onToggleFavorite: (href: string) => void;
  pathname: string;
  pinnedItems: NavItem[];
  roleLabel: string;
  sections: NavSection[];
};

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

function iconKind(label: string, href: string) {
  const value = `${label} ${href}`.toLowerCase();
  if (href === '/' || value.includes('dashboard') || value.includes('command centre')) return 'dashboard';
  if (href === '/work' || value.includes('my work') || value.includes('work order') || value.includes('service job')) return 'clipboard';
  if (value.includes('message') || value.includes('inbox') || value.includes('communication')) return 'message';
  if (value.includes('customer') || value.includes('user') || value.includes('employee')) return 'users';
  if (value.includes('asset') || value.includes('machine') || value.includes('equipment') || value.includes('telemetry')) return 'tool';
  if (value.includes('stock') || value.includes('inventory') || value.includes('warehouse') || value.includes('parts')) return 'box';
  if (value.includes('report') || value.includes('finance') || value.includes('sales') || value.includes('executive')) return 'chart';
  if (value.includes('setting') || value.includes('admin') || value.includes('role')) return 'settings';
  if (value.includes('dispatch') || value.includes('delivery') || value.includes('route')) return 'truck';
  if (value.includes('alert') || value.includes('exception')) return 'bell';
  if (value.includes('search')) return 'search';
  return 'grid';
}

function NavIcon({ kind }: { kind: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24' };
  switch (kind) {
    case 'dashboard':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
    case 'clipboard':
      return <svg {...common}><path d="M9 5h6"/><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z"/><rect x="5" y="5" width="14" height="16" rx="2"/><path d="m9 13 2 2 4-4"/></svg>;
    case 'message':
      return <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.5-4.5A7 7 0 0 1 3 13V9a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v6Z"/><path d="M8 11h8M8 15h5"/></svg>;
    case 'users':
      return <svg {...common}><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 15.5A5 5 0 0 1 21 20"/></svg>;
    case 'tool':
      return <svg {...common}><path d="M14.5 6.5a4 4 0 0 0-5 5L3 18l3 3 6.5-6.5a4 4 0 0 0 5-5l-2.5 2.5-3-3 2.5-2.5Z"/></svg>;
    case 'box':
      return <svg {...common}><path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z"/><path d="M12 11v10"/></svg>;
    case 'chart':
      return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>;
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.8-1.9l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.9-.8L10.5 2h-3l-.7 2a7 7 0 0 0-1.9.8L3 3.9.9 6l.9 1.9A7 7 0 0 0 1 9.8l-2 .7v3l2 .7a7 7 0 0 0 .8 1.9L.9 18l2.1 2.1 1.9-.9a7 7 0 0 0 1.9.8l.7 2h3l.7-2a7 7 0 0 0 1.9-.8l1.9.9L18 18l-.9-1.9a7 7 0 0 0 .8-1.9l2-.7Z" transform="translate(2 0) scale(.83)"/></svg>;
    case 'truck':
      return <svg {...common}><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>;
    case 'bell':
      return <svg {...common}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
    default:
      return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>;
  }
}

function groupedSections(sections: NavSection[], homePath: string) {
  const seen = new Set<string>();
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.href === homePath || item.href === '/work' || seen.has(item.href)) return false;
        seen.add(item.href);
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}

export function DesktopNavigationRail({
  collapsed,
  homePath,
  onToggleCollapse,
  pathname,
  roleLabel,
  sections,
}: DesktopNavigationRailProps) {
  const visibleSections = groupedSections(sections, homePath);

  return (
    <aside aria-label="Application navigation" className={`dallmayr-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="dallmayr-sidebar-brand">
        <Link href={homePath} aria-label="Open Dallmayr ERP home">
          <span aria-hidden="true" className="dallmayr-crest">D</span>
          {!collapsed ? <span><strong>Dallmayr</strong><small>Enterprise Resource Planning</small></span> : null}
        </Link>
        <button aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={onToggleCollapse} type="button">
          <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
        </button>
      </div>

      <nav className="dallmayr-sidebar-nav" aria-label="ERP modules">
        <div className="dallmayr-sidebar-primary">
          <Link className="dallmayr-sidebar-link" aria-current={isActivePath(pathname, homePath) ? 'page' : undefined} href={homePath} title="Dashboard">
            <span aria-hidden="true"><NavIcon kind="dashboard" /></span>{!collapsed ? <strong>Dashboard</strong> : null}
          </Link>
          <Link className="dallmayr-sidebar-link" aria-current={isActivePath(pathname, '/work') ? 'page' : undefined} href="/work" title="My Work">
            <span aria-hidden="true"><NavIcon kind="clipboard" /></span>{!collapsed ? <strong>My Work</strong> : null}
          </Link>
        </div>

        {visibleSections.map((section) => (
          <section className="dallmayr-sidebar-group" key={section.heading} aria-label={section.heading}>
            {!collapsed ? <h2>{section.heading}</h2> : <div className="dallmayr-sidebar-group-divider" aria-hidden="true" />}
            <div>
              {section.items.map((item) => (
                <Link
                  aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
                  className="dallmayr-sidebar-link"
                  href={item.href}
                  key={item.href}
                  title={item.label}
                >
                  <span aria-hidden="true"><NavIcon kind={iconKind(item.label, item.href)} /></span>
                  {!collapsed ? <strong>{item.label}</strong> : null}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </nav>

      <div
        aria-label={`Account menu for ${roleLabel}`}
        className="dallmayr-sidebar-account dallmayr-sidebar-account-menu-target"
        title={collapsed ? `${roleLabel} account menu` : undefined}
      />
    </aside>
  );
}
