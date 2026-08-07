'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { FieldServiceOfflineManager } from '@/components/features/FieldServiceOfflineManager';
import { MobileAppExperience } from '@/components/features/MobileAppExperience';
import { MobileWorkflowEnhancer } from '@/components/ui/MobileWorkflowEnhancer';

const PUBLIC_ROUTES = ['/login', '/onboarding'];

function isPublicRoute(pathname: string) {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function AuthenticatedMobileRuntime() {
  const pathname = usePathname();
  const { businessUser, userDetails } = useAuth();

  // PWA, offline and mobile workflow effects belong to the authenticated ERP,
  // not to public authentication pages. Keeping these components unmounted here
  // prevents service-worker controller reloads and modal scroll locks on /login.
  if (isPublicRoute(pathname) || !businessUser || !userDetails) return null;

  return (
    <>
      <FieldServiceOfflineManager />
      <MobileAppExperience />
      <MobileWorkflowEnhancer />
    </>
  );
}
