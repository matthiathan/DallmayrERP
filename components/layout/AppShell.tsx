'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { DesktopNavigationRail } from '@/components/layout/DesktopNavigationRail';
import { MobileNavigationDrawer, MobileQuickBar } from '@/components/layout/MobileNavigation';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { deriveAppShellNavigation } from '@/components/layout/appShellNavigation';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { ErpStateBanner } from '@/components/ui/ErpLayout';
import { GlobalSearch } from '@/components/ui/GlobalSearch';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getDefaultPathForRole, roleLabels } from '@/lib/auth/permissions';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/browserStorage';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayProfileName, isProfileComplete } from '@/types/dallmayrerp';

const FAVORITES_KEY = 'dallmayr-mobile-favorites-v1';
const RAIL_COLLAPSED_KEY = 'dallmayr-desktop-rail-collapsed-v1';
const MAX_FAVORITES = 4;

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

function safeFavoriteList(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { authUser, businessProfile, businessUser, userDetails, loading, error } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [favoriteHrefs, setFavoriteHrefs] = useState<string[]>([]);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const profileComplete = isProfileComplete(userDetails);
  const role = userDetails?.role;

  useEffect(() => {
    if (!loading && !authUser) router.replace('/login');
  }, [authUser, loading, router]);

  useEffect(() => {
    if (loading || !businessUser || !role) return;

    if (!profileComplete && pathname !== '/onboarding') {
      router.replace('/onboarding');
      return;
    }

    if (profileComplete && pathname === '/onboarding') {
      router.replace(getDefaultPathForRole(role));
      return;
    }

    if (pathname === '/' && role !== 'admin') router.replace(getDefaultPathForRole(role));
  }, [businessUser, loading, pathname, profileComplete, role, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    setFavoriteHrefs(safeFavoriteList(safeLocalStorageGet(FAVORITES_KEY)));
    setRailCollapsed(safeLocalStorageGet(RAIL_COLLAPSED_KEY) === 'true');
  }, []);

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

  const signOut = async () => {
    await getSupabaseClient().auth.signOut();
    window.location.href = '/login';
  };

  if (loading) {
    return <StatusScreen title="Loading secure workspace" message="Checking your Supabase session, access invite and user details." loading />;
  }

  if (!authUser) {
    return <StatusScreen title="Redirecting to sign in" message="You need to sign in before opening DallmayrERP." />;
  }

  if (error) {
    return <StatusScreen title="Profile check failed" message={error} />;
  }

  if (!businessUser) {
    return (
      <StatusScreen
        title="Access pending"
        message="Your login exists in Supabase Auth, but no matching access invite was found in public.users. Ask an administrator to invite your email address first."
        action={<button className="button secondary" onClick={signOut} type="button">Sign out</button>}
      />
    );
  }

  if (!userDetails) {
    return (
      <StatusScreen
        title="Role assignment pending"
        message="Your email exists in public.users, but no corresponding user_details record was found. Ask an administrator to assign your role and branch."
        action={<button className="button secondary" onClick={signOut} type="button">Sign out</button>}
      />
    );
  }

  const {
    activeSection,
    activeTitle,
    allowedPath,
    favoriteItems,
    homePath,
    mobileScanPath,
    mobileTaskPath,
    navigationSections,
    statusQuickLinks,
  } = deriveAppShellNavigation(userDetails.role, pathname, favoriteHrefs);
  const activeBranch = userDetails.branch.toUpperCase();
  const userName = displayProfileName(businessProfile);

  function toggleFavorite(href: string) {
    setFavoriteHrefs((current) => {
      const next = current.includes(href)
        ? current.filter((item) => item !== href)
        : current.length >= MAX_FAVORITES
          ? current
          : [...current, href];
      safeLocalStorageSet(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function toggleRail() {
    setRailCollapsed((current) => {
      const next = !current;
      safeLocalStorageSet(RAIL_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  return (
    <div className={`app-shell top-shell application-shell-v2 ${railCollapsed ? 'desktop-rail-collapsed' : ''} ${menuOpen ? 'mobile-menu-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      {menuOpen ? <button aria-label="Close navigation menu" className="mobile-nav-backdrop" onClick={() => setMenuOpen(false)} type="button" /> : null}

      <header className="application-header">
        <div className="application-header-inner">
          <Link aria-label="Open Today workspace" className="application-brand" href={homePath}>
            <span aria-hidden="true" className="application-brand-mark">D</span>
            <span>DallmayrERP</span>
          </Link>

          <div className="application-header-search">
            <GlobalSearch />
          </div>

          <div className="application-header-actions">
            <DensityToggle />
            <div className="desktop-alerts-target" id="desktop-alerts-target" />
            <div className="desktop-account-menu-target" id="desktop-account-menu-target" />
          </div>

          <div className="application-page-context">
            <span>{activeSection?.heading ?? roleLabels[userDetails.role]}</span>
            <strong>{activeTitle}</strong>
            <small>{activeBranch} &middot; {roleLabels[userDetails.role]}</small>
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
          <span><strong>{activeBranch}</strong>&nbsp;branch</span>
          <span>{roleLabels[userDetails.role]}</span>
          <span>{profileComplete ? 'Profile ready' : 'Profile setup'}</span>
          {statusQuickLinks.map((item) => (
            <Link href={item.href} key={item.href}>{item.label}</Link>
          ))}
        </div>

        <MobileNavigationDrawer
          activeTitle={activeTitle}
          favoriteHrefs={favoriteHrefs}
          homePath={homePath}
          onToggleFavorite={toggleFavorite}
          open={menuOpen}
          pathname={pathname}
          profileComplete={profileComplete}
          roleLabel={roleLabels[userDetails.role]}
          sections={navigationSections}
          setOpen={setMenuOpen}
          userName={userName}
        />
      </header>

      <DesktopNavigationRail
        collapsed={railCollapsed}
        homePath={homePath}
        onToggleCollapse={toggleRail}
        onToggleFavorite={toggleFavorite}
        pathname={pathname}
        pinnedItems={favoriteItems}
        roleLabel={roleLabels[userDetails.role]}
        sections={navigationSections}
      />

      <MobileQuickBar
        homePath={homePath}
        menuOpen={menuOpen}
        pathname={pathname}
        role={userDetails.role}
        scanPath={mobileScanPath}
        setMenuOpen={setMenuOpen}
        taskPath={mobileTaskPath}
      />

      <main className="main top-main application-main" id="main-content" tabIndex={-1}>
        {!allowedPath ? (
          <ErpStateBanner
            action={<Link className="button" href={homePath}>Go to Today</Link>}
            className="access-denied"
            message={<>Your current role is <strong>{roleLabels[userDetails.role]}</strong>. Use the navigation menu to open your assigned pages.</>}
            title="This page is not assigned to your role."
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
