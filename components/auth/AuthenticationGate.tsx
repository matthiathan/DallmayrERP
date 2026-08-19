'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { HamsterLoader } from '@/components/ui/HamsterLoader';

const PUBLIC_AUTH_ROUTES = ['/login', '/reset-password'];

function isPublicAuthRoute(pathname: string) {
  return PUBLIC_AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function AuthenticationStatus({ title, message, loading = false, action }: {
  title: string;
  message: string;
  loading?: boolean;
  action?: ReactNode;
}) {
  return (
    <main aria-busy={loading} className="main auth-state-page" role={loading ? 'status' : 'main'}>
      <div className="neo-card auth-state-card">
        {loading ? <HamsterLoader label={title} /> : null}
        <h1>{title}</h1>
        <p>{message}</p>
        {action ? <div className="action-row">{action}</div> : null}
      </div>
    </main>
  );
}

export function AuthenticationGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { authUser, loading, error, refreshProfile } = useAuth();
  const publicRoute = isPublicAuthRoute(pathname);

  useEffect(() => {
    if (!publicRoute && !loading && !authUser) router.replace('/login');
  }, [authUser, loading, publicRoute, router]);

  if (publicRoute) return <>{children}</>;

  if (loading) {
    return (
      <AuthenticationStatus
        loading
        message="Confirming your encrypted Supabase session."
        title="Opening secure telemetry"
      />
    );
  }

  if (error) {
    return (
      <AuthenticationStatus
        action={<button className="button secondary" onClick={() => void refreshProfile()} type="button">Try again</button>}
        message={error}
        title="Could not verify your session"
      />
    );
  }

  if (!authUser) {
    return (
      <AuthenticationStatus
        message="You need to sign in before opening machine and telemetry data."
        title="Redirecting to sign in"
      />
    );
  }

  return <>{children}</>;
}
