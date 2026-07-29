'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import type { NavSection } from '@/lib/auth/permissions';

type RecentPage = {
  href: string;
  label: string;
};

type MobileNavigationDrawerProps = {
  activeTitle: string;
  homePath: string;
  open: boolean;
  pathname: string;
  profileComplete: boolean;
  recentPages: RecentPage[];
  roleLabel: string;
  sections: NavSection[];
  setOpen: Dispatch<SetStateAction<boolean>>;
  userName: string;
};

type MobileQuickBarProps = {
  homePath: string;
  menuOpen: boolean;
  pathname: string;
  scanPath: string;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  taskPath: string;
};

const FAVORITES_KEY = 'dallmayr-mobile-favorites-v1';
const MAX_FAVORITES = 4;

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

function safeFavorites(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

export function MobileNavigationDrawer({
  activeTitle,
  homePath,
  open,
  pathname,
  profileComplete,
  recentPages,
  roleLabel,
  sections,
  setOpen,
  userName,
}: MobileNavigationDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    setFavorites(safeFavorites(window.localStorage.getItem(FAVORITES_KEY)));
  }, []);

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
        if (!items.has(item.href)) items.set(item.href, item);
      });
    });
    return Array.from(items.values());
  }, [sections]);

  const favoriteItems = useMemo(
    () => favorites
      .map((href) => allItems.find((item) => item.href === href))
      .filter((item): item is NavSection['items'][number] => Boolean(item)),
    [allItems, favorites],
  );

  const recentItems = useMemo(() => {
    const seen = new Set<string>();
    return [...recentPages]
      .reverse()
      .filter((page) => {
        if (seen.has(page.href) || page.href === homePath || page.href === pathname || favorites.includes(page.href)) return false;
        seen.add(page.href);
        return true;
      })
      .slice(0, 4);
  }, [favorites, homePath, pathname, recentPages]);

  function toggleFavorite(href: string) {
    setFavorites((current) => {
      const next = current.includes(href)
        ? current.filter((item) => item !== href)
        : current.length >= MAX_FAVORITES
          ? current
          : [...current, href];
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

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

      <Link
        aria-current={isActivePath(pathname, homePath) ? 'page' : undefined}
        className="mobile-primary-link"
        href={homePath}
      >
        Start Page
      </Link>

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

      {recentItems.length > 0 ? (
        <section aria-label="Recent pages" className="mobile-nav-shortcuts">
          <div className="mobile-nav-shortcut-heading"><strong>Recent</strong></div>
          <div className="mobile-nav-shortcut-grid">
            {recentItems.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
          </div>
        </section>
      ) : null}

      <nav aria-label="Mobile navigation" className="mobile-nav-directory">
        {sections.map((section) => {
          const sectionActive = section.items.some((item) => isActivePath(pathname, item.href));
          return (
            <details className="mobile-nav-section" defaultOpen={sectionActive} key={`${section.heading}-${pathname}`}>
              <summary>
                <span>{section.heading}</span>
                <span>{section.items.length}</span>
              </summary>
              <div className="mobile-nav-section-links">
                {section.items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  const pinned = favorites.includes(item.href);
                  const pinDisabled = !pinned && favorites.length >= MAX_FAVORITES;
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
                        onClick={() => toggleFavorite(item.href)}
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

export function MobileQuickBar({
  homePath,
  menuOpen,
  pathname,
  scanPath,
  setMenuOpen,
  taskPath,
}: MobileQuickBarProps) {
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
        <span aria-hidden="true">⌂</span><strong>Home</strong>
      </Link>
      <Link aria-current={isActivePath(pathname, taskPath) ? 'page' : undefined} href={taskPath}>
        <span aria-hidden="true">✓</span><strong>Tasks</strong>
      </Link>
      <button onClick={openSearch} type="button">
        <span aria-hidden="true">⌕</span><strong>Search</strong>
      </button>
      <Link aria-current={isActivePath(pathname, scanPath) ? 'page' : undefined} href={scanPath}>
        <span aria-hidden="true">▣</span><strong>Scan</strong>
      </Link>
      <button aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)} type="button">
        <span aria-hidden="true">☰</span><strong>Menu</strong>
      </button>
    </nav>
  );
}
