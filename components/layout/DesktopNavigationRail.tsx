'use client';

import Image from 'next/image';
import Link from 'next/link';
import { NavigationIcon, navigationIconKind } from '@/components/layout/NavigationIcon';
import type { NavSection } from '@/lib/auth/permissions';
import { favoritePathname, type FavoriteEntry } from '@/lib/navigation/favorites';
import { FLEET_OVERVIEW_LABEL, FLEET_OVERVIEW_OPEN_LABEL } from '@/lib/navigation/terminology';
import styles from '@/components/telemetry-platform/TelemetryPlatformShell.module.css';

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

function allItems(sections: NavSection[]) {
  const seen = new Set<string>();
  return sections.flatMap((section) => section.items).filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
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
  allItems(sections);

  return (
    <aside
      aria-label="Application navigation"
      className={`${styles.sidebar} dallmayr-sidebar ${collapsed ? 'is-collapsed' : ''}`}
      data-platform-navigation="desktop-v3"
    >
      <div className={styles.sidebarBrand}>
        <Link aria-label={FLEET_OVERVIEW_OPEN_LABEL} href={homePath} title={FLEET_OVERVIEW_LABEL}>
          <span aria-hidden="true" className={styles.brandMark}>
            <Image alt="" height={34} src="/icons/dallmayr-app.svg" width={28} />
          </span>
          {!collapsed ? (
            <span className={styles.brandCopy}>
              <strong>Dallmayr</strong>
              <small>Machine telemetry</small>
            </span>
          ) : null}
        </Link>
        {!collapsed ? (
          <button
            aria-label="Collapse navigation"
            className={styles.collapseButton}
            onClick={onToggleCollapse}
            type="button"
          >
            <NavigationIcon kind="chevron-left" />
          </button>
        ) : null}
      </div>

      <nav aria-label="Machine telemetry navigation" className={styles.sidebarNav}>
        {sections.map((section) => (
          <section className={styles.navGroup} key={section.heading}>
            {!collapsed ? <h2 className={styles.navHeading}>{section.heading}</h2> : null}
            {section.items.map((item) => {
              const active = activeHref === item.href;
              return (
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={`${styles.navLink} dallmayr-sidebar-link ${active ? styles.navLinkActive : ''}`}
                  href={item.href}
                  key={item.href}
                  title={item.label}
                >
                  <span aria-hidden="true" className={styles.navIcon}>
                    <NavigationIcon kind={navigationIconKind(item.label, item.href)} />
                  </span>
                  {!collapsed ? <span className={styles.navLabel}>{item.label}</span> : null}
                </Link>
              );
            })}
          </section>
        ))}

        {pinnedItems.length > 0 ? (
          <section className={styles.navGroup}>
            {!collapsed ? <h2 className={styles.navHeading}>Pinned</h2> : null}
            {pinnedItems.map((item) => {
              const href = favoritePathname(item.href);
              const active = href !== activeHref && isActivePath(pathname, href);
              return (
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={`${styles.navLink} dallmayr-sidebar-link ${active ? styles.navLinkActive : ''}`}
                  href={item.href}
                  key={item.href}
                  title={item.label}
                >
                  <span aria-hidden="true" className={styles.navIcon}>
                    <NavigationIcon kind={navigationIconKind(item.label, href)} />
                  </span>
                  {!collapsed ? <span className={styles.navLabel}>{item.label}</span> : null}
                </Link>
              );
            })}
          </section>
        ) : null}
      </nav>

      <div className={styles.sidebarFooter}>
        <div className="dallmayr-sidebar-account-menu-target" id="desktop-sidebar-account-menu-target" />
        {!collapsed ? <div className={styles.countryChip}><span aria-hidden="true">🇿🇦</span>South Africa fleet</div> : null}
      </div>
    </aside>
  );
}
