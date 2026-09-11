'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NavSection } from '@/lib/auth/permissions';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import { NavigationIcon, navigationIconKind } from '@/components/layout/NavigationIcon';
import styles from '@/components/telemetry-platform/TelemetryPlatformShell.module.css';

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

  const allItems = useMemo(() => navigationSections.flatMap((section) => section.items), [navigationSections]);
  const primaryItems = useMemo(() => [homePath, '/machines', '/alerts', '/telemetry']
    .map((href) => allItems.find((item) => item.href === href))
    .filter((item): item is NonNullable<typeof item> => Boolean(item)), [allItems, homePath]);
  const primaryHrefs = useMemo(() => new Set(primaryItems.map((item) => item.href)), [primaryItems]);
  const moreActive = Boolean(activeHref && !primaryHrefs.has(activeHref));

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  if (!mobileEnabled) return null;

  const closeMenu = () => {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  return (
    <div className={`${styles.mobileShell} telemetry-mobile-shell`} data-mobile-shell="v1" data-platform-navigation="mobile-v3">
      <header className={`${styles.mobileHeader} telemetry-mobile-header`}>
        <Link aria-label="Open Fleet Overview" className={styles.mobileBrand} href={homePath}>
          <Image alt="" height={32} src="/icons/dallmayr-app.svg" width={27} />
        </Link>

        <div className={styles.mobileTitle}>
          <strong>{activeTitle}</strong>
          <small>Dallmayr Machine Telemetry</small>
        </div>

        <div className={styles.mobileActions}>
          <div className={styles.mobileSearch}>
            <GlobalSearch triggerLabel="Search machine, device or page" />
          </div>
          <Link aria-label="Open alerts" className={styles.mobileAction} href="/alerts">
            <NavigationIcon kind="bell" />
          </Link>
          <div className="telemetry-mobile-account-target" id="mobile-account-menu-target" />
        </div>
      </header>

      <nav aria-label="Primary mobile navigation" className={`${styles.mobileBottomNav} telemetry-mobile-bottom-nav`}>
        {primaryItems.map((item) => {
          const active = activeHref === item.href;
          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={`${styles.mobileNavItem} telemetry-mobile-nav-item ${active ? styles.mobileNavActive : ''}`}
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
          aria-current={moreActive ? 'page' : undefined}
          aria-expanded={menuOpen}
          className={`${styles.mobileNavItem} telemetry-mobile-nav-item telemetry-mobile-more ${moreActive || menuOpen ? styles.mobileNavActive : ''}`}
          onClick={() => setMenuOpen((current) => !current)}
          ref={menuButtonRef}
          type="button"
        >
          <NavigationIcon kind="menu" />
          <span>More</span>
        </button>
      </nav>

      {menuOpen ? (
        <div className={`${styles.mobileMenuLayer} telemetry-mobile-menu-layer`}>
          <button aria-label="Close navigation menu" className={styles.mobileBackdrop} onClick={closeMenu} type="button" />
          <section
            aria-label="Telemetry navigation"
            aria-modal="true"
            className={`${styles.mobileMenu} telemetry-mobile-menu-panel`}
            id="telemetry-mobile-menu"
            role="dialog"
          >
            <div className={styles.mobileMenuHeader}>
              <div className={styles.mobileIdentity}>
                <strong>{userName}</strong>
                <small>{userEmail || 'Signed in'}</small>
              </div>
              <button aria-label="Close navigation menu" className={styles.mobileAction} onClick={closeMenu} ref={closeButtonRef} type="button">
                <NavigationIcon kind="close" />
              </button>
            </div>

            <div className={styles.mobileMenuScroll}>
              {navigationSections.map((section) => (
                <section className={styles.mobileMenuSection} key={section.heading}>
                  <h2>{section.heading}</h2>
                  {section.items.map((item) => {
                    const active = activeHref === item.href;
                    return (
                      <Link
                        aria-current={active ? 'page' : undefined}
                        className={`${styles.mobileMenuLink} ${active ? styles.mobileMenuLinkActive : ''}`}
                        href={item.href}
                        key={item.href}
                        onClick={() => setMenuOpen(false)}
                      >
                        <span className={styles.mobileMenuIcon}><NavigationIcon kind={navigationIconKind(item.label, item.href)} /></span>
                        <span className={styles.mobileMenuCopy}><strong>{item.label}</strong><small>{item.description}</small></span>
                        <NavigationIcon kind="chevron-right" />
                      </Link>
                    );
                  })}
                </section>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
