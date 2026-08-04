'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import type { NavSection } from '@/lib/auth/permissions';
import type { BusinessRole } from '@/types/dallmayrerp';

type MobileNavigationDrawerProps = {
  activeTitle: string;
  favoriteHrefs: string[];
  homePath: string;
  onToggleFavorite: (href: string) => void;
  open: boolean;
  pathname: string;
  profileComplete: boolean;
  roleLabel: string;
  sections: NavSection[];
  setOpen: Dispatch<SetStateAction<boolean>>;
  userName: string;
};

type MobileQuickBarProps = {
  homePath: string;
  menuOpen: boolean;
  pathname: string;
  role: BusinessRole;
  scanPath: string;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  taskPath: string;
};

const MAX_FAVORITES = 4;

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

export function MobileNavigationDrawer({
  activeTitle,
  favoriteHrefs,
  homePath,
  onToggleFavorite,
  open,
  pathname,
  profileComplete,
  roleLabel,
  sections,
  setOpen,
  userName,
}: MobileNavigationDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : document.querySelector<HTMLElement>('.hamburger-button.notch-mobile-button');

    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true');

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      const restoreTarget = restoreFocusRef.current
        ?? document.querySelector<HTMLElement>('.hamburger-button.notch-mobile-button');
      window.requestAnimationFrame(() => restoreTarget?.focus());
    };
  }, [open, setOpen]);

  const allItems = useMemo(() => {
    const items = new Map<string, NavSection['items'][number]>();
    sections.forEach((section) => {
      section.items.forEach((item) => {
        if (item.href === '/messages') return;
        if (!items.has(item.href)) items.set(item.href, item);
      });
    });
    return Array.from(items.values());
  }, [sections]);

  const directorySections = useMemo(
    () => sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.href !== '/messages'),
      }))
      .filter((section) => section.items.length > 0),
    [sections],
  );

  const favoriteItems = useMemo(
    () => favoriteHrefs
      .map((href) => allItems.find((item) => item.href === href))
      .filter((item): item is NavSection['items'][number] => Boolean(item)),
    [allItems, favoriteHrefs],
  );

  return (
    <div
      aria-labelledby="mobile-navigation-title"
      aria-modal="true"
      className="mobile-nav-panel"
      hidden={!open}
      id="mobile-navigation"
      ref={panelRef}
      role="dialog"
    >
      <div className="mobile-nav-header">
        <div>
          <span>Menu</span>
          <h2 id="mobile-navigation-title">{activeTitle}</h2>
        </div>
        <button
          aria-label="Close navigation menu"
          className="mobile-nav-close"
          onClick={() => setOpen(false)}
          ref={closeButtonRef}
          type="button"
        >
          <span aria-hidden="true">×</span>
          <span>Close</span>
        </button>
      </div>

      <div className="mobile-nav-search">
        <GlobalSearch
          enableShortcut={false}
          showShortcut={false}
          triggerClassName="mobile-global-search-trigger"
          triggerLabel="Search customers, jobs, machines and stock"
        />
      </div>

      <div className="user-chip mobile-user-chip">
        <span>{userName}</span>
        <strong>{roleLabel}</strong>
        {!profileComplete ? <em>Profile setup required</em> : null}
      </div>

      <div className="mobile-primary-actions">
        <Link aria-current={isActivePath(pathname, homePath) ? 'page' : undefined} href={homePath}>
          <span aria-hidden="true">⌂</span><strong>Today</strong>
        </Link>
        <Link aria-current={isActivePath(pathname, '/work') ? 'page' : undefined} href="/work">
          <span aria-hidden="true">✓</span><strong>My Work</strong>
        </Link>
        <Link aria-current={isActivePath(pathname, '/messages') ? 'page' : undefined} href="/messages">
          <span aria-hidden="true">M</span><strong>Messages</strong>
        </Link>
        <button onClick={() => window.dispatchEvent(new Event('dallmayr-open-alerts'))} type="button">
          <span aria-hidden="true">♢</span><strong>Inbox</strong>
        </button>
      </div>

      {favoriteItems.length > 0 ? (
        <section aria-label="Pinned pages" className="mobile-nav-shortcuts">
          <div className="mobile-nav-shortcut-heading">
            <strong>Pinned</strong>
            <span>{favoriteItems.length}/{MAX_FAVORITES}</span>
          </div>
          <div className="mobile-nav-shortcut-grid">
            {favoriteItems.map((item) => (
              <Link href={item.href} key={item.href}>{item.label}</Link>
            ))}
          </div>
        </section>
      ) : null}

      <nav aria-label="Mobile navigation" className="mobile-nav-directory">
        {directorySections.map((section) => {
          const sectionActive = section.items.some((item) => isActivePath(pathname, item.href));
          return (
            <details className="mobile-nav-section" key={`${section.heading}-${pathname}`} open={sectionActive || undefined}>
              <summary>
                <span>{section.heading}</span>
                <span>{section.items.length}</span>
              </summary>
              <div className="mobile-nav-section-links">
                {section.items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  const pinned = favoriteHrefs.includes(item.href);
                  const pinDisabled = !pinned && favoriteHrefs.length >= MAX_FAVORITES;
                  return (
                    <div className="mobile-nav-item-row" key={item.href}>
                      <Link
                        aria-current={active ? 'page' : undefined}
                        className={`nav-link mobile-nav-card ${active ? 'active' : ''}`}
                        href={item.href}
                      >
                        <span className="nav-card-copy">
                          <strong>{item.label}</strong>
                          {item.description ? <small>{item.description}</small> : null}
                        </span>
                      </Link>
                      <button
                        aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
                        aria-pressed={pinned}
                        className="mobile-nav-pin"
                        disabled={pinDisabled}
                        onClick={() => onToggleFavorite(item.href)}
                        title={pinDisabled ? `You can pin up to ${MAX_FAVORITES} pages` : undefined}
                        type="button"
                      >
                        <span aria-hidden="true">{pinned ? '★' : '☆'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </nav>

      <footer className="mobile-nav-footer">
        <div>
          <strong>Account and appearance</strong>
          <small>Change theme or sign out.</small>
        </div>
        <div className="mobile-account-menu-target" id="mobile-account-menu-target" />
      </footer>
    </div>
  );
}

const quickLabels: Record<BusinessRole, { label: string; icon: string }> = {
  admin: { label: 'Work', icon: '✓' },
  operations: { label: 'Dispatch', icon: '⇄' },
  sales: { label: 'Sales', icon: '↗' },
  finance: { label: 'Finance', icon: '$' },
  marketing: { label: 'Marketing', icon: '◎' },
  executive: { label: 'Overview', icon: '◇' },
  warehouse_staff: { label: 'Stock', icon: '▦' },
  technician: { label: 'Jobs', icon: '✓' },
  road_technician: { label: 'Routes', icon: '⌖' },
};

export function MobileQuickBar({
  homePath,
  menuOpen,
  pathname,
  role,
  scanPath,
  setMenuOpen,
  taskPath,
}: MobileQuickBarProps) {
  const fieldRole = role === 'technician' || role === 'road_technician';
  const warehouseRole = role === 'warehouse_staff';
  const primary = quickLabels[role];

  function openSearch() {
    const trigger = document.querySelector<HTMLButtonElement>('.mobile-global-search-trigger');
    if (trigger) {
      trigger.click();
      return;
    }
    setMenuOpen(true);
  }

  return (
    <nav aria-label="Mobile quick actions" className="mobile-quick-bar">
      <Link aria-current={isActivePath(pathname, homePath) ? 'page' : undefined} href={homePath}>
        <span aria-hidden="true">⌂</span><strong>Today</strong>
      </Link>
      <Link aria-current={isActivePath(pathname, taskPath) ? 'page' : undefined} href={taskPath}>
        <span aria-hidden="true">{primary.icon}</span><strong>{primary.label}</strong>
      </Link>
      <Link aria-current={isActivePath(pathname, '/messages') ? 'page' : undefined} href="/messages">
        <span aria-hidden="true">M</span><strong>Messages</strong>
      </Link>
      {fieldRole || warehouseRole ? (
        <Link aria-current={isActivePath(pathname, scanPath) ? 'page' : undefined} href={scanPath}>
          <span aria-hidden="true">▣</span><strong>Scan</strong>
        </Link>
      ) : (
        <button aria-label="Open global search" onClick={openSearch} type="button">
          <span aria-hidden="true">⌕</span><strong>Search</strong>
        </button>
      )}
      <button aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)} type="button">
        <span aria-hidden="true">☰</span><strong>Menu</strong>
      </button>
    </nav>
  );
}
