'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { canAccessPath, getDefaultPathForRole, isNavItemAllowed, navSections, roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayProfileName, isProfileComplete } from '@/types/dallmayrerp';
import { HamsterLoader } from '@/components/ui/HamsterLoader';

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
    <main className="main auth-state-page">
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
  const { authUser, businessProfile, businessUser, userDetails, loading, error } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const profileComplete = isProfileComplete(userDetails);
  const role = userDetails?.role;

  useEffect(() => {
    if (!loading && !authUser) {
      router.replace('/login');
    }
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

    if (pathname === '/' && role !== 'admin') {
      router.replace(getDefaultPathForRole(role));
    }
  }, [businessUser, loading, pathname, profileComplete, role, router]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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

  const allowedPath = canAccessPath(userDetails.role, pathname);
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isNavItemAllowed(userDetails.role, item)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className={`app-shell top-shell ${menuOpen ? 'mobile-menu-open' : ''}`}>
      <header className="topbar">
        <div className="topbar-main">
          <Link className="topbar-brand" href={getDefaultPathForRole(userDetails.role)}>
            <span className="brand">DallmayrERP</span>
            <span className="brand-subtitle">Role-based operations platform</span>
          </Link>

          <nav aria-label="Primary navigation" className="desktop-nav">
            {visibleSections.map((section) => (
              <div className="topnav-section" key={section.heading}>
                <span className="nav-heading">{section.heading}</span>
                <div className="topnav-links">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      className={`nav-link ${pathname === item.href ? 'active' : ''}`}
                      href={item.href}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="topbar-user">
            <div className="user-chip">
              <span>{displayProfileName(businessProfile)}</span>
              <strong>{roleLabels[userDetails.role]}</strong>
              {!profileComplete ? <em>Profile setup required</em> : null}
            </div>
            <button className="button secondary sign-out" onClick={signOut} type="button">
              Sign out
            </button>
          </div>

          <button
            aria-controls="mobile-navigation"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="hamburger-button"
            onClick={() => setMenuOpen((current) => !current)}
            type="button"
          >
            <span />
            <span />
            <span />
          </button>
        </div>

        <div className="mobile-nav-panel" hidden={!menuOpen} id="mobile-navigation">
          <div className="user-chip mobile-user-chip">
            <span>{displayProfileName(businessProfile)}</span>
            <strong>{roleLabels[userDetails.role]}</strong>
            {!profileComplete ? <em>Profile setup required</em> : null}
          </div>
          <nav aria-label="Mobile navigation">
            {visibleSections.map((section) => (
              <div className="nav-section" key={section.heading}>
                <div className="nav-heading">{section.heading}</div>
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    className={`nav-link ${pathname === item.href ? 'active' : ''}`}
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <button className="button secondary sign-out" onClick={signOut} type="button">
            Sign out
          </button>
        </div>
      </header>

      <main className="main top-main">
        {!allowedPath ? (
          <div className="neo-card access-denied">
            <div className="badge danger">Access blocked</div>
            <h1>This page is not assigned to your role.</h1>
            <p>
              Your current role is <strong>{roleLabels[userDetails.role]}</strong>. Use the navigation menu to open your assigned pages.
            </p>
            <Link className="button" href={getDefaultPathForRole(userDetails.role)}>Go to my workspace</Link>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
