'use client';

import Link from 'next/link';
import { NavigationIcon, navigationIconKind } from '@/components/layout/NavigationIcon';
import type { NavSection } from '@/lib/auth/permissions';
import { favoritePathname, type FavoriteEntry } from '@/lib/navigation/favorites';
import { MY_WORK_LABEL, TODAY_LABEL, TODAY_OPEN_LABEL } from '@/lib/navigation/terminology';

type DesktopNavigationRailProps = {
  activeHref: string | null;
  collapsed: boolean;
  homePath: string;
  onToggleCollapse: () => void;
  pathname: string;
  pinnedItems: FavoriteEntry[];
  roleLabel: string;
  sections: NavSection[];
};

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

function isPinnedPathActive(pathname: string, href: string, activeHref: string | null) {
  if (href.includes('?')) return false;
  const pinnedPath = favoritePathname(href);
  if (pinnedPath === activeHref) return false;
  return isActivePath(pathname, pinnedPath);
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
  activeHref,
  collapsed,
  homePath,
  onToggleCollapse,
  pathname,
  pinnedItems,
  roleLabel,
  sections,
}: DesktopNavigationRailProps) {
  const visibleSections = groupedSections(sections, homePath);

  return (
    <aside aria-label="Application navigation" className={`dallmayr-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="dallmayr-sidebar-brand">
        <Link href={homePath} aria-label={TODAY_OPEN_LABEL}>
          <span aria-hidden="true" className="dallmayr-crest">D</span>
          {!collapsed ? <span><strong>Dallmayr</strong><small>Enterprise Resource Planning</small></span> : null}
        </Link>
        <button aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={onToggleCollapse} type="button">
          <span aria-hidden="true"><NavigationIcon kind={collapsed ? 'chevron-right' : 'chevron-left'} /></span>
        </button>
      </div>

      <nav className="dallmayr-sidebar-nav" aria-label="ERP navigation">
        <div className="dallmayr-sidebar-primary">
          <Link aria-label={TODAY_LABEL} className="dallmayr-sidebar-link" aria-current={activeHref === homePath ? 'page' : undefined} href={homePath} title={TODAY_LABEL}>
            <span aria-hidden="true"><NavigationIcon kind="dashboard" /></span>{!collapsed ? <strong>{TODAY_LABEL}</strong> : null}
          </Link>
          <Link aria-label={MY_WORK_LABEL} className="dallmayr-sidebar-link" aria-current={activeHref === '/work' ? 'page' : undefined} href="/work" title={MY_WORK_LABEL}>
            <span aria-hidden="true"><NavigationIcon kind="clipboard" /></span>{!collapsed ? <strong>{MY_WORK_LABEL}</strong> : null}
          </Link>
        </div>

        {pinnedItems.length > 0 ? (
          <section aria-label="Pinned pages" className="dallmayr-sidebar-group dallmayr-sidebar-pinned-group">
            {!collapsed ? <h2>Pinned</h2> : <div className="dallmayr-sidebar-group-divider" aria-hidden="true" />}
            <div>
              {pinnedItems.map((item) => {
                const pinnedPath = favoritePathname(item.href);
                return (
                  <Link
                    aria-current={isPinnedPathActive(pathname, item.href, activeHref) ? 'page' : undefined}
                    className="dallmayr-sidebar-link"
                    href={item.href}
                    key={item.href}
                    title={item.label}
                  >
                    <span aria-hidden="true"><NavigationIcon kind={navigationIconKind(item.label, pinnedPath)} /></span>
                    {!collapsed ? <strong>{item.label}</strong> : null}
                  </Link>
                );
              })}
            </div>
          </section>
        ) : null}

        {visibleSections.map((section) => (
          <section className="dallmayr-sidebar-group" key={section.heading} aria-label={section.heading}>
            {!collapsed ? <h2>{section.heading}</h2> : <div className="dallmayr-sidebar-group-divider" aria-hidden="true" />}
            <div>
              {section.items.map((item) => (
                <Link
                  aria-current={activeHref === item.href ? 'page' : undefined}
                  className="dallmayr-sidebar-link"
                  href={item.href}
                  key={item.href}
                  title={item.label}
                >
                  <span aria-hidden="true"><NavigationIcon kind={navigationIconKind(item.label, item.href)} /></span>
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
