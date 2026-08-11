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

function navigationGlyph(label: string) {
  const words = label.replace(/&/g, ' ').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join('') : label.slice(0, 2)).toUpperCase();
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
            <span aria-hidden="true">DB</span>{!collapsed ? <strong>Dashboard</strong> : null}
          </Link>
          <Link className="dallmayr-sidebar-link" aria-current={isActivePath(pathname, '/work') ? 'page' : undefined} href="/work" title="My Work">
            <span aria-hidden="true">MW</span>{!collapsed ? <strong>My Work</strong> : null}
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
                  <span aria-hidden="true">{navigationGlyph(item.label)}</span>
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
        id="desktop-account-menu-target"
        title={collapsed ? `${roleLabel} account menu` : undefined}
      />
    </aside>
  );
}
