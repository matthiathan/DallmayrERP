'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { canAccessPath, getDefaultPathForRole, isNavItemAllowed, navSections, roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayUserName } from '@/types/dallmayrerp';

function StatusScreen({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <main className="main auth-state-page">
      <div className="neo-card auth-state-card">
        <div className="orb" />
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
  const { authUser, businessUser, loading, error } = useAuth();

  useEffect(() => {
    if (!loading && !authUser) {
      router.replace('/login');
    }
  }, [authUser, loading, router]);

  useEffect(() => {
    if (loading || !businessUser) return;

    if (businessUser.onboarding_required && pathname !== '/onboarding') {
      router.replace('/onboarding');
      return;
    }

    if (!businessUser.onboarding_required && pathname === '/onboarding') {
      router.replace(getDefaultPathForRole(businessUser.role));
      return;
    }

    if (pathname === '/' && businessUser.role !== 'admin') {
      router.replace(getDefaultPathForRole(businessUser.role));
    }
  }, [businessUser, loading, pathname, router]);

  const signOut = async () => {
    await getSupabaseClient().auth.signOut();
    window.location.href = '/login';
  };

  if (loading) {
    return <StatusScreen title="Loading secure workspace" message="Checking your Supabase session and business role." />;
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
        message="Your login exists in Supabase Auth, but no matching business profile was found in public.users. Ask an administrator to invite your email address first."
        action={<button className="button secondary" onClick={signOut} type="button">Sign out</button>}
      />
    );
  }

  const allowedPath = canAccessPath(businessUser.role, pathname);
  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isNavItemAllowed(businessUser.role, item)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="app-shell">
      <aside className="sidebar neo-sidebar">
        <div className="brand">DallmayrERP</div>
        <div className="brand-subtitle">Role-based operations platform</div>
        <div className="user-chip">
          <span>{displayUserName(businessUser)}</span>
          <strong>{roleLabels[businessUser.role]}</strong>
          {businessUser.onboarding_required ? <em>Profile setup required</em> : null}
        </div>
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
        <button className="button secondary sign-out" onClick={signOut} type="button">
          Sign out
        </button>
      </aside>
      <main className="main">
        {!allowedPath ? (
          <div className="neo-card access-denied">
            <div className="badge danger">Access blocked</div>
            <h1>This page is not assigned to your role.</h1>
            <p>
              Your current role is <strong>{roleLabels[businessUser.role]}</strong>. Use the navigation on the left to open your assigned pages.
            </p>
            <Link className="button" href={getDefaultPathForRole(businessUser.role)}>Go to my workspace</Link>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
