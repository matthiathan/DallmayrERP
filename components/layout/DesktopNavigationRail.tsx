'use client';

import Link from 'next/link';
import { LineIcon, type LineIconName } from '@/components/ui/LineIcon';
import type { NavItem, NavSection } from '@/lib/auth/permissions';

type DesktopNavigationRailProps = {
  collapsed: boolean;
  dashboardPath: string;
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

function navigationIcon(item: Pick<NavItem, 'href' | 'label'>): LineIconName {
  const label = item.label.toLowerCase();
  if (item.href === '/customers' || label.includes('customer')) return 'customers';
  if (item.href.includes('/assets') || label.includes('machine') || label.includes('asset')) return 'equipment';
  if (item.href.includes('service-jobs') || label.includes('work order') || label.includes('call log')) return 'work-orders';
  if (item.href.includes('/warehouse') || label.includes('stock') || label.includes('inventory') || label.includes('purchase')) return 'inventory';
  if (item.href === '/work/messages' || label.includes('message')) return 'messages';
  if (item.href.includes('/report') || item.href.includes('/executive') || label.includes('report') || label.includes('performance')) return 'reports';
  if (item.href.includes('/telemetry')) return 'telemetry';
  if (label.includes('user') || label.includes('role')) return 'users';
  return 'grid';
}

function groupedSections(sections: NavSection[], excludedHrefs: Set<string>) {
  const seen = new Set<string>();
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (excludedHrefs.has(item.href) || seen.has(item.href)) return false;
        seen.add(item.href);
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}

function findItem(items: NavItem[], href: string) {
  return items.find((item) => item.href === href);
}

export function DesktopNavigationRail({
  collapsed,
  dashboardPath,
  homePath,
  onToggleCollapse,
  pathname,
  roleLabel,
  sections,
}: DesktopNavigationRailProps) {
  const allItems = sections.flatMap((section) => section.items);
  const reports = sections.find((section) => section.heading === 'Reports')?.items[0];
  const alerts = findItem(allItems, '/operations/exceptions');
  const quickModules = [
    findItem(allItems, '/customers'),
    findItem(allItems, '/operations/assets'),
    findItem(allItems, '/operations/service-jobs') ?? findItem(allItems, '/work/execution'),
    findItem(allItems, '/warehouse/stock'),
    reports,
    findItem(allItems, '/work/messages'),
  ].filter((item): item is NavItem => Boolean(item));

  const quickModulesUnique = quickModules.filter((item, index, items) => items.findIndex((candidate) => candidate.href === item.href) === index);
  const excludedHrefs = new Set([dashboardPath, homePath, '/work', ...quickModulesUnique.map((item) => item.href)]);
  const remainingSections = groupedSections(sections, excludedHrefs);
  const commandLabel = roleLabel === 'Administrator' ? 'ADMIN COMMAND CENTRE' : `${roleLabel.toUpperCase()} WORKSPACE`;

  function openInbox() {
    window.dispatchEvent(new Event('dallmayr-open-alerts'));
  }

  function openSearch() {
    window.dispatchEvent(new Event('dallmayr-open-global-search'));
  }

  return (
    <aside aria-label="Application navigation" className={`dallmayr-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="dallmayr-sidebar-brand">
        <Link href={dashboardPath} aria-label="Open Dallmayr ERP dashboard">
          <span aria-hidden="true" className="dallmayr-crest">D</span>
          {!collapsed ? (
            <span className="dallmayr-wordmark">
              <span><strong>Dallmayr</strong><b>ERP</b></span>
              <small>{commandLabel}</small>
            </span>
          ) : null}
        </Link>
        <button aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} className="dallmayr-sidebar-collapse" onClick={onToggleCollapse} type="button">
          <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
        </button>
      </div>

      <nav className="dallmayr-sidebar-nav" aria-label="ERP modules">
        <div className="dallmayr-sidebar-primary">
          <Link className="dallmayr-sidebar-link" aria-current={isActivePath(pathname, dashboardPath) ? 'page' : undefined} href={dashboardPath} title="Dashboard">
            <span aria-hidden="true"><LineIcon name="dashboard" size={25} /></span>{!collapsed ? <strong>Dashboard</strong> : null}
          </Link>
          <Link className="dallmayr-sidebar-link" aria-current={isActivePath(pathname, '/work') ? 'page' : undefined} href="/work" title="My Work">
            <span aria-hidden="true"><LineIcon name="work" size={25} /></span>{!collapsed ? <strong>My Work</strong> : null}
          </Link>
          <button className="dallmayr-sidebar-link" onClick={openInbox} title="Inbox" type="button">
            <span aria-hidden="true"><LineIcon name="inbox" size={25} /></span>{!collapsed ? <strong>Inbox</strong> : null}
          </button>
          <Link className="dallmayr-sidebar-link" aria-current={alerts && isActivePath(pathname, alerts.href) ? 'page' : undefined} href={alerts?.href ?? '/work'} title="Alerts">
            <span aria-hidden="true"><LineIcon name="alerts" size={25} /></span>{!collapsed ? <strong>Alerts</strong> : null}
          </Link>
          <button className="dallmayr-sidebar-link" onClick={openSearch} title="Search" type="button">
            <span aria-hidden="true"><LineIcon name="search" size={25} /></span>{!collapsed ? <strong>Search</strong> : null}
          </button>
        </div>

        {quickModulesUnique.length ? <div className="dallmayr-sidebar-separator" aria-hidden="true" /> : null}

        <div className="dallmayr-sidebar-modules">
          {quickModulesUnique.map((item) => (
            <Link
              aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
              className="dallmayr-sidebar-link"
              href={item.href}
              key={item.href}
              title={item.label}
            >
              <span aria-hidden="true"><LineIcon name={navigationIcon(item)} size={25} /></span>
              {!collapsed ? <strong>{item.href === '/operations/assets' ? 'Equipment' : item.href === '/operations/service-jobs' ? 'Work Orders' : item.href === '/warehouse/stock' ? 'Parts & Inventory' : item.label}</strong> : null}
            </Link>
          ))}
        </div>

        {remainingSections.length && !collapsed ? (
          <details className="dallmayr-sidebar-more">
            <summary><LineIcon name="grid" size={22} /><strong>All modules</strong><span aria-hidden="true">›</span></summary>
            <div className="dallmayr-sidebar-more-content">
              {remainingSections.map((section) => (
                <section className="dallmayr-sidebar-group" key={section.heading} aria-label={section.heading}>
                  <h2>{section.heading}</h2>
                  <div>
                    {section.items.map((item) => (
                      <Link
                        aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
                        className="dallmayr-sidebar-link"
                        href={item.href}
                        key={item.href}
                        title={item.label}
                      >
                        <span aria-hidden="true"><LineIcon name={navigationIcon(item)} size={20} /></span>
                        <strong>{item.label}</strong>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </details>
        ) : null}
      </nav>

      <div
        aria-label={`Account menu for ${roleLabel}`}
        className="dallmayr-sidebar-account dallmayr-sidebar-account-menu-target"
        id="desktop-account-menu-target"
        title={collapsed ? `${roleLabel} account menu` : undefined}
      />
    </aside>
  );
}
