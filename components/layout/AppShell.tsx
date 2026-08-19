'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { DesktopNavigationRail } from '@/components/layout/DesktopNavigationRail';
import { MobileNavigationDrawer, MobileQuickBar } from '@/components/layout/MobileNavigation';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { canAccessShellPath, deriveAppShellNavigation } from '@/components/layout/appShellNavigation';
import { useAppShellPreferences } from '@/components/layout/useAppShellPreferences';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { ErpStateBanner } from '@/components/ui/ErpLayout';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { favoritePathname } from '@/lib/navigation/favorites';
import { displayProfileName } from '@/types/dallmayrerp';

function StatusScreen({
  title,
  message,
  action,
  loading = false,
}: {
  title: string;
  message: string;
  action?: ReactNode;
  loading?: boolean;
}) {
  return (
    <main aria-busy={loading} className="main auth-state-page" role={loading ? 'status' : 'main'}>
      <div className="neo-card auth-state-card">
        <div className="orb" />
        {loading ? <HamsterLoader label={title} /> : null}
        <h1>{title}</h1>
        <p>{message}</p>
        {action ? <div className="action-row">{action}</div> : null}
      </div>
    </main>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { authUser, businessProfile, loading, error } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const { favoriteEntries, railCollapsed, toggleFavorite, toggleRail } = useAppShellPreferences();

  useEffect(() => {
    if (!loading && !authUser) router.replace('/login');
  }, [authUser, loading, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  if (loading) {
    return <StatusScreen title="Loading secure workspace" message="Checking your Supabase session." loading />;
  }

  if (!authUser) {
    return <StatusScreen title="Redirecting to sign in" message="You need to sign in before opening Dallmayr Machine Telemetry." />;
  }

  if (error) {
    return <StatusScreen title="Session check failed" message={error} />;
  }

  const {
    activeHref,
    activeSection,
    activeTitle,
    allowedPath,
    homePath,
    mobileTaskPath,
    navigationSections,
    statusQuickLinks,
  } = deriveAppShellNavigation(pathname);
  const metadataName = typeof authUser.user_metadata?.full_name === 'string'
    ? authUser.user_metadata.full_name.trim()
    : '';
  const legacyProfileName = businessProfile ? displayProfileName(businessProfile) : '';
  const userName = metadataName || legacyProfileName || authUser.email?.split('@')[0] || 'Telemetry user';
  const activeArea = activeSection?.heading ?? 'Telemetry';
  const visibleFavorites = favoriteEntries.filter((entry) => canAccessShellPath(favoritePathname(entry.href)));

  return (
    <div className={`app-shell top-shell application-shell-v2 ${railCollapsed ? 'desktop-rail-collapsed' : ''} ${menuOpen ? 'mobile-menu-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      {menuOpen ? <button aria-label="Close navigation menu" className="mobile-nav-backdrop" onClick={() => setMenuOpen(false)} type="button" /> : null}

      <header className="application-header">
        <div className="application-header-inner">
          <Link aria-label="Open Fleet Overview" className="application-brand" href={homePath}>
            <span aria-hidden="true" className="application-brand-mark">D</span>
            <span>Dallmayr Telemetry</span>
          </Link>

          <div className="application-header-search">
            <GlobalSearch triggerLabel="Search machine, serial, QR or device ID" />
          </div>

          <div className="application-header-actions">
            <div className="telemetry-header-branch"><NavigationIcon kind="pin" /><span>South Africa</span><span aria-hidden="true">⌄</span></div>
            <div className="telemetry-sync-state"><i aria-hidden="true" />Synced just now</div>
            <Link aria-label="Open active alerts" className="telemetry-header-alerts" href="/alerts"><NavigationIcon kind="bell" /><span aria-hidden="true">!</span></Link>
            <div className="desktop-account-menu-target" id="desktop-account-menu-target" />
          </div>

          <div aria-label={`Current area: ${activeArea}`} className="application-page-context telemetry-page-context-contract">
            <span>{activeArea}</span>
          </div>

          <button
            aria-controls="mobile-navigation"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="hamburger-button notch-mobile-button application-mobile-menu-button"
            onClick={() => setMenuOpen((current) => !current)}
            type="button"
          >
            <NavigationIcon kind={menuOpen ? 'close' : 'menu'} />
          </button>
        </div>

        <div aria-label="Workspace status" className="application-status-strip">
          <span><strong>South Africa</strong></span>
          <span>Telemetry access</span>
          <span>{authUser.email}</span>
          {statusQuickLinks.map((item) => (
            <Link href={item.href} key={item.href}>{item.label}</Link>
          ))}
        </div>

        <MobileNavigationDrawer
          activeHref={activeHref}
          activeTitle={activeTitle}
          favorites={visibleFavorites}
          homePath={homePath}
          onToggleFavorite={toggleFavorite}
          open={menuOpen}
          pathname={pathname}
          accountLabel="Telemetry account"
          sections={navigationSections}
          setOpen={setMenuOpen}
          userName={userName}
        />
      </header>

      <DesktopNavigationRail
        activeHref={activeHref}
        collapsed={railCollapsed}
        homePath={homePath}
        onToggleCollapse={toggleRail}
        pathname={pathname}
        pinnedItems={visibleFavorites}
        sections={navigationSections}
      />

      <MobileQuickBar
        homePath={homePath}
        menuOpen={menuOpen}
        pathname={pathname}
        setMenuOpen={setMenuOpen}
        taskPath={mobileTaskPath}
      />

      <main className="main top-main application-main" id="main-content" tabIndex={-1}>
        {!allowedPath ? (
          <ErpStateBanner
            action={<Link className="button" href={homePath}>Open Fleet Overview</Link>}
            className="access-denied"
            message="This application contains machine and telemetry pages only. Use the navigation menu to return to the active workspace."
            title="This page is outside the telemetry workspace."
            tone="danger"
          />
        ) : (
          <>
            <Breadcrumbs />
            {children}
          </>
        )}
      </main>
    </div>
  );
}
