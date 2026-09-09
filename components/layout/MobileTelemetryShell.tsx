'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NavSection } from '@/lib/auth/permissions';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import { NavigationIcon, navigationIconKind } from '@/components/layout/NavigationIcon';

const MOBILE_SHELL_MEDIA = '(max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse)';

function useMobileShellEnabled() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_SHELL_MEDIA);
    const sync = () => setEnabled(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return enabled;
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'U';
}

export function MobileTelemetryShell({
  activeHref,
  activeTitle,
  homePath,
  navigationSections,
  userEmail,
  userName,
}: {
  activeHref: string | null | undefined;
  activeTitle: string;
  homePath: string;
  navigationSections: NavSection[];
  userEmail: string;
  userName: string;
}) {
  const pathname = usePathname();
  const mobileEnabled = useMobileShellEnabled();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const primaryItems = useMemo(() => {
    const allItems = navigationSections.flatMap((section) => section.items);
    return [homePath, '/machines', '/alerts', '/telemetry']
      .map((href) => allItems.find((item) => item.href === href))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [homePath, navigationSections]);

  const primaryHrefs = useMemo(() => new Set(primaryItems.map((item) => item.href)), [primaryItems]);
  const moreActive = Boolean(activeHref && !primaryHrefs.has(activeHref));

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  if (!mobileEnabled) return null;

  function closeMenuAndRestoreFocus() {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  return (
    <div className="telemetry-mobile-shell" data-mobile-shell="v1">
      <header className="telemetry-mobile-header">
        <Link aria-label="Open Fleet Overview" className="telemetry-mobile-brand" href={homePath}>
          <span aria-hidden="true" className="telemetry-mobile-brand-mark">D</span>
          <span className="telemetry-mobile-brand-copy">
            <strong>Dallmayr Telemetry</strong>
            <small>{activeTitle}</small>
          </span>
        </Link>

        <div className="telemetry-mobile-header-actions">
          <div className="telemetry-mobile-search-target">
            <GlobalSearch triggerLabel="Search machine, serial, QR or device ID" />
          </div>
          <Link aria-label="Open alerts" className="telemetry-mobile-icon-button" href="/alerts">
            <NavigationIcon kind="bell" />
          </Link>
          <div className="telemetry-mobile-account-target" id="mobile-account-menu-target" />
        </div>
      </header>

      <nav aria-label="Primary mobile navigation" className="telemetry-mobile-bottom-nav">
        {primaryItems.map((item) => {
          const active = activeHref === item.href;
          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={`telemetry-mobile-nav-item ${active ? 'is-active' : ''}`}
              href={item.href}
              key={item.href}
            >
              <NavigationIcon kind={navigationIconKind(item.label, item.href)} />
              <span>{item.href === '/' ? 'Overview' : item.label}</span>
            </Link>
          );
        })}
        <button
          aria-controls="telemetry-mobile-menu"
          aria-expanded={menuOpen}
          className={`telemetry-mobile-nav-item telemetry-mobile-more ${moreActive || menuOpen ? 'is-active' : ''}`}
          onClick={() => setMenuOpen((current) => !current)}
          ref={menuButtonRef}
          type="button"
        >
          <NavigationIcon kind="menu" />
          <span>More</span>
        </button>
      </nav>

      {menuOpen ? (
        <div className="telemetry-mobile-menu-layer">
          <button
            aria-label="Close navigation menu"
            className="telemetry-mobile-menu-backdrop"
            onClick={closeMenuAndRestoreFocus}
            type="button"
          />
          <section
            aria-label="Telemetry navigation"
            aria-modal="true"
            className="telemetry-mobile-menu-panel"
            id="telemetry-mobile-menu"
            role="dialog"
          >
            <div className="telemetry-mobile-menu-handle" aria-hidden="true" />
            <div className="telemetry-mobile-menu-heading">
              <div className="telemetry-mobile-menu-identity">
                <span aria-hidden="true">{initialsFor(userName)}</span>
                <div><strong>{userName}</strong><small>{userEmail}</small></div>
              </div>
              <button
                aria-label="Close navigation menu"
                className="telemetry-mobile-icon-button"
                onClick={closeMenuAndRestoreFocus}
                ref={closeButtonRef}
                type="button"
              >
                <NavigationIcon kind="close" />
              </button>
            </div>

            <div className="telemetry-mobile-menu-sections">
              {navigationSections.map((section) => (
                <section className="telemetry-mobile-menu-section" key={section.heading}>
                  <h2>{section.heading}</h2>
                  <div className="telemetry-mobile-menu-links">
                    {section.items.map((item) => {
                      const active = activeHref === item.href;
                      return (
                        <Link
                          aria-current={active ? 'page' : undefined}
                          className={`telemetry-mobile-menu-link ${active ? 'is-active' : ''}`}
                          href={item.href}
                          key={item.href}
                          onClick={() => setMenuOpen(false)}
                        >
                          <span className="telemetry-mobile-menu-link-icon"><NavigationIcon kind={navigationIconKind(item.label, item.href)} /></span>
                          <span className="telemetry-mobile-menu-link-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                          <NavigationIcon kind="chevron-right" />
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
