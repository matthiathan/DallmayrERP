'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { DesktopNavigationRail } from '@/components/layout/DesktopNavigationRail';
import { MobileTelemetryShell } from '@/components/layout/MobileTelemetryShell';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { canAccessShellPath, deriveAppShellNavigation } from '@/components/layout/appShellNavigation';
import { useAppShellPreferences } from '@/components/layout/useAppShellPreferences';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { ErpStateBanner } from '@/components/ui/ErpLayout';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { favoritePathname } from '@/lib/navigation/favorites';
import { displayProfileName } from '@/types/dallmayrerp';
import styles from '@/components/telemetry-platform/TelemetryPlatformShell.module.css';

function StatusScreen({ title, message, loading = false }: { title: string; message: string; loading?: boolean }) {
  return (
    <main aria-busy={loading} className="main auth-state-page" role={loading ? 'status' : 'main'}>
      <div className="neo-card auth-state-card">
        {loading ? <HamsterLoader label={title} /> : null}
        <h1>{title}</h1>
        <p>{message}</p>
      </div>
    </main>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { authUser, businessProfile, loading, error } = useAuth();
  const { favoriteEntries, railCollapsed, toggleRail } = useAppShellPreferences();

  useEffect(() => {
    if (!loading && !authUser) router.replace('/login');
  }, [authUser, loading, router]);

  if (loading) return <StatusScreen title="Loading telemetry" message="Checking your secure session." loading />;
  if (!authUser) return <StatusScreen title="Redirecting to sign in" message="Sign in is required to open Dallmayr Machine Telemetry." />;
  if (error) return <StatusScreen title="Session check failed" message={error} />;

  const {
    activeHref,
    activeSection,
    activeTitle,
    allowedPath,
    homePath,
    navigationSections,
  } = deriveAppShellNavigation(pathname);

  const metadataName = typeof authUser.user_metadata?.full_name === 'string'
    ? authUser.user_metadata.full_name.trim()
    : '';
  const legacyProfileName = businessProfile ? displayProfileName(businessProfile) : '';
  const userName = metadataName || legacyProfileName || authUser.email?.split('@')[0] || 'Telemetry user';
  const visibleFavorites = favoriteEntries.filter((entry) => canAccessShellPath(favoritePathname(entry.href)));

  return (
    <div
      className={`${styles.shell} ${styles.desktopShell} application-shell-v2 app-shell ${railCollapsed ? `${styles.desktopCollapsed} desktop-rail-collapsed` : ''}`}
      data-platform-shell="telemetry-v3"
    >
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <DesktopNavigationRail
        activeHref={activeHref}
        collapsed={railCollapsed}
        homePath={homePath}
        onToggleCollapse={toggleRail}
        pathname={pathname}
        pinnedItems={visibleFavorites}
        sections={navigationSections}
      />

      <header className={`${styles.topbar} application-header`}>
        <div className={styles.pageContext}>
          <span>{activeSection?.heading ?? 'Telemetry'}</span>
          <strong>{activeTitle}</strong>
        </div>
        <div className={styles.searchSlot}>
          <GlobalSearch triggerLabel="Search machine, serial, QR or device ID" />
        </div>
        <div className={styles.topbarActions}>
          <div className={styles.headerChip}><NavigationIcon kind="pin" />South Africa</div>
          <div className={styles.headerChip}><i aria-hidden="true" />Live telemetry</div>
          <Link aria-label="Open active alerts" className={styles.headerIcon} href="/alerts">
            <NavigationIcon kind="bell" />
            <span aria-hidden="true" className={styles.alertDot} />
          </Link>
          <div className="desktop-account-menu-target" id="desktop-account-menu-target" />
        </div>
      </header>

      <MobileTelemetryShell
        activeHref={activeHref}
        activeTitle={activeTitle}
        homePath={homePath}
        navigationSections={navigationSections}
        userEmail={authUser.email ?? ''}
        userName={userName}
      />

      <main className={`${styles.main} application-main main top-main`} id="main-content" tabIndex={-1}>
        {!allowedPath ? (
          <ErpStateBanner
            action={<Link className="button" href={homePath}>Open Fleet Overview</Link>}
            className="access-denied"
            message="This application contains machine and telemetry pages only."
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
