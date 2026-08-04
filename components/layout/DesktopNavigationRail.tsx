'use client';

import Link from 'next/link';
import { useEffect } from 'react';
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
  const glyph = words.length > 1
    ? words.slice(0, 2).map((word) => word[0]).join('')
    : label.slice(0, 2);
  return glyph.toUpperCase();
}

function openInbox() {
  window.dispatchEvent(new Event('dallmayr-open-alerts'));
}

export function DesktopNavigationRail({
  collapsed,
  homePath,
  onToggleCollapse,
  onToggleFavorite,
  pathname,
  pinnedItems,
  roleLabel,
  sections,
}: DesktopNavigationRailProps) {
  useEffect(() => {
    function openFieldQueue() {
      document.querySelector<HTMLButtonElement>('.field-offline-indicator')?.click();
    }

    window.addEventListener('dallmayr-open-field-queue', openFieldQueue);
    return () => window.removeEventListener('dallmayr-open-field-queue', openFieldQueue);
  }, []);

  const directorySections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.href !== homePath && item.href !== '/work' && item.href !== '/messages'),
    }))
    .filter((section) => section.items.length > 0);
  const visiblePinnedItems = pinnedItems.filter((item) => item.href !== homePath && item.href !== '/work' && item.href !== '/messages');
  const allItems = directorySections.flatMap((section) => section.items);
  const collapsedItems = [
    ...visiblePinnedItems,
    ...allItems.filter((item) => !pinnedItems.some((pinned) => pinned.href === item.href)),
  ];

  return (
    <aside aria-label="Application navigation" className={`desktop-navigation-rail monday-navigation-rail ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="desktop-rail-heading">
        {!collapsed ? (
          <details className="monday-workspace-switcher">
            <summary>
              <span aria-hidden="true" className="monday-workspace-icon">D</span>
              <span><small>Workspace</small><strong>{roleLabel}</strong></span>
              <span aria-hidden="true" className="monday-workspace-chevron">v</span>
            </summary>
            <div className="monday-workspace-menu">
              <Link href={homePath}><span aria-hidden="true">T</span><span><strong>Today</strong><small>Priorities and work queues</small></span></Link>
              <Link href="/work"><span aria-hidden="true">W</span><span><strong>My Work</strong><small>Assigned work and approvals</small></span></Link>
              <Link href="/messages"><span aria-hidden="true">M</span><span><strong>Messages</strong><small>Internal chat and files</small></span></Link>
              <button onClick={openInbox} type="button"><span aria-hidden="true">I</span><span><strong>Inbox</strong><small>Operational notifications</small></span></button>
            </div>
          </details>
        ) : null}
        <button
          aria-label={collapsed ? 'Expand application navigation' : 'Collapse application navigation'}
          className="desktop-rail-collapse"
          onClick={onToggleCollapse}
          type="button"
        >
          <span aria-hidden="true">{collapsed ? '>' : '<'}</span>
        </button>
      </div>

      {collapsed ? (
        <nav aria-label="Collapsed application navigation" className="desktop-rail-collapsed-links">
          <Link aria-current={isActivePath(pathname, homePath) ? 'page' : undefined} className="desktop-rail-glyph-link" href={homePath} title="Today">
            <span aria-hidden="true">T</span><span className="sr-only">Today</span>
          </Link>
          <Link aria-current={isActivePath(pathname, '/work') ? 'page' : undefined} className="desktop-rail-glyph-link" href="/work" title="My Work">
            <span aria-hidden="true">W</span><span className="sr-only">My Work</span>
          </Link>
          <Link aria-current={isActivePath(pathname, '/messages') ? 'page' : undefined} className="desktop-rail-glyph-link" href="/messages" title="Messages">
            <span aria-hidden="true">M</span><span className="sr-only">Messages</span>
          </Link>
          <button aria-label="Open Inbox" className="desktop-rail-glyph-link" onClick={openInbox} title="Inbox" type="button">
            <span aria-hidden="true">I</span>
          </button>
          {collapsedItems.slice(0, 10).map((item) => (
            <Link aria-current={isActivePath(pathname, item.href) ? 'page' : undefined} className="desktop-rail-glyph-link" href={item.href} key={item.href} title={item.label}>
              <span aria-hidden="true">{navigationGlyph(item.label)}</span><span className="sr-only">{item.label}</span>
            </Link>
          ))}
        </nav>
      ) : (
        <>
          <nav aria-label="Role navigation" className="desktop-rail-navigation">
            <div className="monday-primary-navigation">
              <Link aria-current={isActivePath(pathname, homePath) ? 'page' : undefined} href={homePath}>
                <span aria-hidden="true">T</span><span><strong>Today</strong><small>Your role workspace</small></span>
              </Link>
              <Link aria-current={isActivePath(pathname, '/work') ? 'page' : undefined} href="/work">
                <span aria-hidden="true">W</span><span><strong>My Work</strong><small>Assigned tasks and approvals</small></span>
              </Link>
              <Link aria-current={isActivePath(pathname, '/messages') ? 'page' : undefined} href="/messages">
                <span aria-hidden="true">M</span><span><strong>Messages</strong><small>Internal chat and files</small></span>
              </Link>
              <button onClick={openInbox} type="button">
                <span aria-hidden="true">I</span><span><strong>Inbox</strong><small>Notifications and exceptions</small></span>
              </button>
            </div>

            {visiblePinnedItems.length > 0 ? (
              <section aria-label="Favourite boards" className="desktop-rail-shortcuts monday-favourites">
                <div className="desktop-rail-section-label"><strong>Favourites</strong><span>{visiblePinnedItems.length}</span></div>
                {visiblePinnedItems.map((item) => (
                  <div className="desktop-rail-item-row" key={item.href}>
                    <Link aria-current={isActivePath(pathname, item.href) ? 'page' : undefined} href={item.href}>
                      <span aria-hidden="true" className="desktop-rail-item-glyph">{navigationGlyph(item.label)}</span>
                      <span><strong>{item.label}</strong><small>{item.description}</small></span>
                    </Link>
                    <button aria-label={`Remove ${item.label} from favourites`} onClick={() => onToggleFavorite(item.href)} type="button">*</button>
                  </div>
                ))}
              </section>
            ) : null}

            <div className="desktop-rail-directory">
              <div className="desktop-rail-section-label monday-directory-label"><strong>Boards and tools</strong></div>
              {directorySections.map((section) => {
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
                            <button aria-label={pinned ? `Remove ${item.label} from favourites` : `Add ${item.label} to favourites`} aria-pressed={pinned} onClick={() => onToggleFavorite(item.href)} type="button">
                              {pinned ? '*' : '+'}
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

        </>
      )}
    </aside>
  );
}
