'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { isProfileComplete } from '@/types/dallmayrerp';

const PUBLIC_AUTH_ROUTES = ['/login', '/reset-password', '/rfid-scanner'];

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
  const { authUser, businessUser, userDetails, loading, error, refreshProfile } = useAuth();
  const publicRoute = isPublicAuthRoute(pathname);
  const onboardingRoute = pathname === '/onboarding' || pathname.startsWith('/onboarding/');
  const onboardingRequired = Boolean(
    authUser
    && businessUser?.is_active
    && (!userDetails?.telemetry_region || !isProfileComplete(userDetails)),
  );

  useEffect(() => {
    if (!publicRoute && !loading && !authUser) {
      router.replace('/login');
      return;
    }

    if (!publicRoute && !loading && authUser && businessUser?.is_active) {
      if (onboardingRequired && !onboardingRoute) router.replace('/onboarding');
      else if (!onboardingRequired && onboardingRoute) router.replace('/');
    }
  }, [authUser, businessUser, loading, onboardingRequired, onboardingRoute, publicRoute, router]);

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

  if (!businessUser) {
    return (
      <AuthenticationStatus
        action={<button className="button secondary" onClick={() => void refreshProfile()} type="button">Reload account</button>}
        message="Your account is being prepared for first-time setup."
        title="Preparing your account"
      />
    );
  }

  if (onboardingRequired && !onboardingRoute) {
    return (
      <AuthenticationStatus
        loading
        message="Choose your telemetry region and complete your personal details before opening the workspace."
        title="Opening account setup"
      />
    );
  }

  return <>{children}</>;
}
