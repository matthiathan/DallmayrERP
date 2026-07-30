'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { NavItem, NavSection } from '@/lib/auth/permissions';

type RecentPage = {
  href: string;
  label: string;
};

type DesktopNavigationRailProps = {
  collapsed: boolean;
  homePath: string;
  onToggleCollapse: () => void;
  onToggleFavorite: (href: string) => void;
  pathname: string;
  pinnedItems: NavItem[];
  recentPages: RecentPage[];
  roleLabel: string;
  sections: NavSection[];
};

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

function navigationGlyph(label: string) {
  const words = label.replace(/&/g, ' ').split(/\s+/).filter(Boolean);
  const glyph = words.length > 1
    ? words.slice(0, 2).map((word) => word[0]).join('')
    : label.slice(0, 2);
  return glyph.toUpperCase();
}

export function DesktopNavigationRail({
  collapsed,
  homePath,
  onToggleCollapse,
  onToggleFavorite,
  pathname,
  pinnedItems,
  recentPages,
  roleLabel,
  sections,
}: DesktopNavigationRailProps) {
  useEffect(() => {
    function openAlerts() {
      document.querySelector<HTMLButtonElement>('.mobile-app-alert-trigger')?.click();
    }

    function openFieldQueue() {
      document.querySelector<HTMLButtonElement>('.field-offline-indicator')?.click();
    }

    window.addEventListener('dallmayr-open-alerts', openAlerts);
    window.addEventListener('dallmayr-open-field-queue', openFieldQueue);
    return () => {
      window.removeEventListener('dallmayr-open-alerts', openAlerts);
      window.removeEventListener('dallmayr-open-field-queue', openFieldQueue);
    };
  }, []);

  const allItems = sections.flatMap((section) => section.items);
  const collapsedItems = [
    ...pinnedItems,
    ...allItems.filter((item) => !pinnedItems.some((pinned) => pinned.href === item.href)),
  ];

  return (
    <aside aria-label="Application navigation" className={`desktop-navigation-rail ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="desktop-rail-heading">
        <div>
          <span>Workspace</span>
          <strong>{roleLabel}</strong>
        </div>
        <button
          aria-label={collapsed ? 'Expand application navigation' : 'Collapse application navigation'}
          className="desktop-rail-collapse"
          onClick={onToggleCollapse}
          type="button"
        >
          <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
        </button>
      </div>

      {collapsed ? (
        <nav aria-label="Collapsed application navigation" className="desktop-rail-collapsed-links">
          <Link
            aria-current={isActivePath(pathname, homePath) ? 'page' : undefined}
            className="desktop-rail-glyph-link"
            href={homePath}
            title="Today"
          >
            <span aria-hidden="true">⌂</span>
            <span className="sr-only">Today</span>
          </Link>
          {collapsedItems.map((item) => (
            <Link
              aria-current={isActivePath(pathname, item.href) ? 'page' : undefined}
              className="desktop-rail-glyph-link"
              href={item.href}
              key={item.href}
              title={item.label}
            >
              <span aria-hidden="true">{navigationGlyph(item.label)}</span>
              <span className="sr-only">{item.label}</span>
            </Link>
          ))}
        </nav>
      ) : (
        <>
          <nav aria-label="Role navigation" className="desktop-rail-navigation">
            <Link
              aria-current={isActivePath(pathname, homePath) ? 'page' : undefined}
              className="desktop-rail-home"
              href={homePath}
            >
              <span aria-hidden="true">⌂</span>
              <span><strong>Today</strong><small>Your role workspace and priorities</small></span>
            </Link>

            {pinnedItems.length > 0 ? (
              <section aria-label="Pinned pages" className="desktop-rail-shortcuts">
                <div className="desktop-rail-section-label"><strong>Pinned</strong><span>{pinnedItems.length}</span></div>
                {pinnedItems.map((item) => (
                  <div className="desktop-rail-item-row" key={item.href}>
                    <Link aria-current={isActivePath(pathname, item.href) ? 'page' : undefined} href={item.href}>
                      <span aria-hidden="true" className="desktop-rail-item-glyph">{navigationGlyph(item.label)}</span>
                      <span><strong>{item.label}</strong><small>{item.description}</small></span>
                    </Link>
                    <button aria-label={`Unpin ${item.label}`} onClick={() => onToggleFavorite(item.href)} type="button">★</button>
                  </div>
                ))}
              </section>
            ) : null}

            <div className="desktop-rail-directory">
              {sections.map((section) => {
                const active = section.items.some((item) => isActivePath(pathname, item.href));
                return (
                  <details className="desktop-rail-section" key={section.heading} open={active || undefined}>
                    <summary><span>{section.heading}</span><small>{section.items.length}</small></summary>
                    <div className="desktop-rail-section-links">
                      {section.items.map((item) => {
                        const pinned = pinnedItems.some((pinnedItem) => pinnedItem.href === item.href);
                        return (
                          <div className="desktop-rail-item-row" key={item.href}>
                            <Link aria-current={isActivePath(pathname, item.href) ? 'page' : undefined} href={item.href}>
                              <span aria-hidden="true" className="desktop-rail-item-glyph">{navigationGlyph(item.label)}</span>
                              <span><strong>{item.label}</strong><small>{item.description}</small></span>
                            </Link>
                            <button
                              aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
                              aria-pressed={pinned}
                              onClick={() => onToggleFavorite(item.href)}
                              type="button"
                            >
                              {pinned ? '★' : '☆'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
            </div>
          </nav>

          {recentPages.length > 0 ? (
            <section aria-label="Recent pages" className="desktop-rail-recent">
              <div className="desktop-rail-section-label"><strong>Recent</strong></div>
              {recentPages.slice(0, 4).map((page) => (
                <Link aria-current={isActivePath(pathname, page.href) ? 'page' : undefined} href={page.href} key={page.href}>
                  <span aria-hidden="true">↗</span><span>{page.label}</span>
                </Link>
              ))}
            </section>
          ) : null}
        </>
      )}
    </aside>
  );
}
