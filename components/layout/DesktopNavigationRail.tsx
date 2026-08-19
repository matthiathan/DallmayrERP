'use client';

import Link from 'next/link';
import Image from 'next/image';
import { NavigationIcon, navigationIconKind } from '@/components/layout/NavigationIcon';
import type { NavSection } from '@/lib/auth/permissions';
import { favoritePathname, type FavoriteEntry } from '@/lib/navigation/favorites';
import { FLEET_OVERVIEW_LABEL, FLEET_OVERVIEW_OPEN_LABEL } from '@/lib/navigation/terminology';

type DesktopNavigationRailProps = {
  activeHref: string | null;
  collapsed: boolean;
  homePath: string;
  onToggleCollapse: () => void;
  pathname: string;
  pinnedItems: FavoriteEntry[];
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

function navigationItems(sections: NavSection[], homePath: string) {
  const seen = new Set<string>();
  return sections.flatMap((section) => section.items).filter((item) => {
    if (item.href === '/work' || seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  }).sort((left, right) => {
    const order = [homePath, '/machines', '/alerts', '/telemetry', '/map', '/telemetry/devices'];
    return order.indexOf(left.href) - order.indexOf(right.href);
  });
}

export function DesktopNavigationRail({
  activeHref,
  collapsed,
  homePath,
  onToggleCollapse,
  pathname,
  pinnedItems,
  sections,
}: DesktopNavigationRailProps) {
  const visibleItems = navigationItems(sections, homePath);

  return (
    <aside aria-label="Application navigation" className={`dallmayr-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="dallmayr-sidebar-brand">
        <Link href={homePath} aria-label={FLEET_OVERVIEW_OPEN_LABEL} title={FLEET_OVERVIEW_LABEL}>
          <span aria-hidden="true" className="dallmayr-crest"><Image alt="" height={42} src="/icons/dallmayr-app.svg" width={35} /></span>
          {!collapsed ? <span><strong>Dallmayr</strong><small>Vending &amp; coffee solutions</small></span> : null}
        </Link>
        <button aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={onToggleCollapse} type="button">
          <span aria-hidden="true"><NavigationIcon kind={collapsed ? 'chevron-right' : 'chevron-left'} /></span>
        </button>
      </div>

      <nav className="dallmayr-sidebar-nav" aria-label="Machine telemetry navigation">
        <div className="dallmayr-sidebar-primary">
          {visibleItems.map((item) => (
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

      </nav>

      <div className="dallmayr-sidebar-account dallmayr-sidebar-account-menu-target telemetry-sidebar-account-fallback" />
      <div className="telemetry-country-label" title="South Africa telemetry"><span aria-hidden="true">🇿🇦</span>{!collapsed ? <strong>South Africa</strong> : null}</div>
    </aside>
  );
}
