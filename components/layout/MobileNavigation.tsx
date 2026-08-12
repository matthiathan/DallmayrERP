'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { NavigationIcon, navigationIconKind, type NavigationIconKind } from '@/components/layout/NavigationIcon';
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
const OPEN_SEARCH_EVENT = 'dallmayr-open-global-search';

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DU';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : document.querySelector<HTMLElement>('.hamburger-button.notch-mobile-button');

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.classList.add('mobile-navigation-dialog-open');

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
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true' && !element.hasAttribute('hidden'));

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
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      document.documentElement.classList.remove('mobile-navigation-dialog-open');
      const restoreTarget = restoreFocusRef.current
        ?? document.querySelector<HTMLElement>('.hamburger-button.notch-mobile-button');
      window.requestAnimationFrame(() => restoreTarget?.focus());
    };
  }, [open, setOpen]);

  const allItems = useMemo(() => {
    const items = new Map<string, NavSection['items'][number]>();
    sections.forEach((section) => section.items.forEach((item) => {
      if (!items.has(item.href)) items.set(item.href, item);
    }));
    return Array.from(items.values());
  }, [sections]);

  const favoriteItems = useMemo(
    () => favoriteHrefs
      .map((href) => allItems.find((item) => item.href === href))
      .filter((item): item is NavSection['items'][number] => Boolean(item)),
    [allItems, favoriteHrefs],
  );

  if (!mounted || !open) return null;

  return createPortal(
    <div className="mobile-nav-portal-root mobile-menu-v2" data-mobile-overlay="navigation">
      <button aria-label="Close navigation menu" className="mobile-nav-backdrop" onClick={() => setOpen(false)} type="button" />
      <div
        aria-label={`${activeTitle} navigation`}
        aria-labelledby="mobile-navigation-title"
        aria-modal="true"
        className="mobile-nav-panel mobile-menu-v2-panel"
        id="mobile-navigation"
        ref={panelRef}
        role="dialog"
      >
        <header className="mobile-menu-v2-profile">
          <div className="mobile-menu-v2-avatar" aria-hidden="true">
            <span>{initials(userName)}</span><i />
          </div>
          <div className="mobile-menu-v2-identity">
            <h2 id="mobile-navigation-title">{userName}</h2>
            <strong>{roleLabel}</strong>
            {!profileComplete ? <small>Profile setup required</small> : null}
          </div>
          <button aria-label="Close navigation menu" className="mobile-menu-v2-close" onClick={() => setOpen(false)} ref={closeButtonRef} type="button"><NavigationIcon kind="close" /></button>
        </header>

        <nav aria-label="Mobile navigation" className="mobile-menu-v2-nav">
          <Link aria-current={isActivePath(pathname, homePath) ? 'page' : undefined} className="mobile-menu-v2-link mobile-menu-v2-home" href={homePath} onClick={() => setOpen(false)}>
            <span className="mobile-menu-v2-icon" aria-hidden="true"><NavigationIcon kind="dashboard" /></span>
            <span className="mobile-menu-v2-copy"><strong>Dashboard</strong></span>
          </Link>

          <Link aria-current={isActivePath(pathname, '/work') ? 'page' : undefined} className="mobile-menu-v2-link" href="/work" onClick={() => setOpen(false)}>
            <span className="mobile-menu-v2-icon" aria-hidden="true"><NavigationIcon kind="clipboard" /></span>
            <span className="mobile-menu-v2-copy"><strong>My Work</strong></span>
            <span className="mobile-menu-v2-chevron" aria-hidden="true"><NavigationIcon kind="chevron-right" /></span>
          </Link>

          <button className="mobile-menu-v2-link mobile-menu-v2-button" onClick={() => { setOpen(false); window.dispatchEvent(new Event('dallmayr-open-alerts')); }} type="button">
            <span className="mobile-menu-v2-icon" aria-hidden="true"><NavigationIcon kind="bell" /></span>
            <span className="mobile-menu-v2-copy"><strong>Inbox & Alerts</strong></span>
            <span className="mobile-menu-v2-chevron" aria-hidden="true"><NavigationIcon kind="chevron-right" /></span>
          </button>

          <div className="mobile-menu-v2-search-row">
            <span className="mobile-menu-v2-icon" aria-hidden="true"><NavigationIcon kind="search" /></span>
            <GlobalSearch enableShortcut={false} showShortcut={false} triggerClassName="mobile-global-search-trigger mobile-menu-v2-search-trigger" triggerLabel="Search" />
            <span className="mobile-menu-v2-chevron" aria-hidden="true"><NavigationIcon kind="chevron-right" /></span>
          </div>

          {favoriteItems.length > 0 ? (
            <section className="mobile-menu-v2-group mobile-menu-v2-favorites" aria-label="Pinned pages">
              <p className="mobile-menu-v2-section-label">Pinned</p>
              {favoriteItems.map((item) => (
                <div className="mobile-menu-v2-item-with-action" key={`fav-${item.href}`}>
                  <Link className="mobile-menu-v2-link" href={item.href} onClick={() => setOpen(false)}>
                    <span className="mobile-menu-v2-icon" aria-hidden="true"><NavigationIcon kind={navigationIconKind(item.label, item.href)} /></span>
                    <span className="mobile-menu-v2-copy"><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span>
                    <span className="mobile-menu-v2-chevron" aria-hidden="true"><NavigationIcon kind="chevron-right" /></span>
                  </Link>
                  <button aria-label={`Unpin ${item.label}`} className="mobile-menu-v2-pin" onClick={() => onToggleFavorite(item.href)} type="button"><NavigationIcon kind="pin-filled" /></button>
                </div>
              ))}
            </section>
          ) : null}

          {sections.map((section) => (
            <section className="mobile-menu-v2-group" key={section.heading}>
              <p className="mobile-menu-v2-section-label">{section.heading}</p>
              {section.items.map((item) => {
                const active = isActivePath(pathname, item.href);
                const pinned = favoriteHrefs.includes(item.href);
                const pinDisabled = !pinned && favoriteHrefs.length >= MAX_FAVORITES;
                return (
                  <div className="mobile-menu-v2-item-with-action" key={item.href}>
                    <Link aria-current={active ? 'page' : undefined} className={`mobile-menu-v2-link ${active ? 'is-active' : ''}`} href={item.href} onClick={() => setOpen(false)}>
                      <span className="mobile-menu-v2-icon" aria-hidden="true"><NavigationIcon kind={navigationIconKind(item.label, item.href)} /></span>
                      <span className="mobile-menu-v2-copy"><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span>
                      <span className="mobile-menu-v2-chevron" aria-hidden="true"><NavigationIcon kind="chevron-right" /></span>
                    </Link>
                    <button aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`} aria-pressed={pinned} className="mobile-menu-v2-pin" disabled={pinDisabled} onClick={() => onToggleFavorite(item.href)} title={pinDisabled ? `You can pin up to ${MAX_FAVORITES} pages` : undefined} type="button"><NavigationIcon kind={pinned ? 'pin-filled' : 'pin'} /></button>
                  </div>
                );
              })}
            </section>
          ))}
        </nav>

        <footer className="mobile-menu-v2-footer">
          <div className="mobile-menu-v2-footer-heading"><strong>Account & appearance</strong><small>Profile, theme and sign out</small></div>
          <div className="mobile-account-menu-target" id="mobile-account-menu-target" />
        </footer>
      </div>
    </div>,
    document.body,
  );
}

const quickLabels: Record<BusinessRole, { label: string; kind: NavigationIconKind }> = {
  admin: { label: 'Work', kind: 'clipboard' },
  operations: { label: 'Dispatch', kind: 'truck' },
  sales: { label: 'Sales', kind: 'sales' },
  finance: { label: 'Finance', kind: 'finance' },
  marketing: { label: 'Marketing', kind: 'marketing' },
  executive: { label: 'Overview', kind: 'chart' },
  warehouse_staff: { label: 'Stock', kind: 'box' },
  technician: { label: 'Jobs', kind: 'clipboard' },
  road_technician: { label: 'Routes', kind: 'truck' },
};

export function MobileQuickBar({ homePath, menuOpen, pathname, role, scanPath, setMenuOpen, taskPath }: MobileQuickBarProps) {
  const fieldRole = role === 'technician' || role === 'road_technician';
  const warehouseRole = role === 'warehouse_staff';
  const primary = quickLabels[role];

  function openSearch() { setMenuOpen(false); window.dispatchEvent(new Event(OPEN_SEARCH_EVENT)); }
  function openAlerts() { setMenuOpen(false); window.dispatchEvent(new Event('dallmayr-open-alerts')); }
  function openQueue() { setMenuOpen(false); window.dispatchEvent(new Event('dallmayr-open-field-queue')); }

  return (
    <nav aria-label="Mobile quick actions" className="mobile-quick-bar">
      <Link aria-current={isActivePath(pathname, homePath) ? 'page' : undefined} href={homePath}><span aria-hidden="true"><NavigationIcon kind="dashboard" /></span><strong>Today</strong></Link>
      <Link aria-current={isActivePath(pathname, taskPath) ? 'page' : undefined} href={taskPath}><span aria-hidden="true"><NavigationIcon kind={primary.kind} /></span><strong>{primary.label}</strong></Link>
      {fieldRole || warehouseRole ? <Link aria-current={isActivePath(pathname, scanPath) ? 'page' : undefined} href={scanPath}><span aria-hidden="true"><NavigationIcon kind="scan" /></span><strong>Scan</strong></Link> : <button aria-label="Open global search" onClick={openSearch} type="button"><span aria-hidden="true"><NavigationIcon kind="search" /></span><strong>Search</strong></button>}
      {fieldRole ? <button aria-label="Open offline work queue" onClick={openQueue} type="button"><span aria-hidden="true"><NavigationIcon kind="queue" /></span><strong>Queue</strong></button> : <button aria-label="Open notifications" onClick={openAlerts} type="button"><span aria-hidden="true"><NavigationIcon kind="bell" /></span><strong>Alerts</strong></button>}
      <button aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)} type="button"><span aria-hidden="true"><NavigationIcon kind="menu" /></span><strong>Menu</strong></button>
    </nav>
  );
}
