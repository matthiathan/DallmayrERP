'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const RESPONSIVE_QUERY = '(max-width: 900px), (max-width: 1366px) and (hover: none) and (pointer: coarse)';
const PUBLIC_RESPONSIVE_ROUTES = ['/login', '/onboarding'];
const TRANSIENT_CLASSES = [
  'mobile-navigation-dialog-open',
  'mobile-workflow-detail-open',
];

function isPublicResponsiveRoute(pathname: string) {
  return PUBLIC_RESPONSIVE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function restoreNativeDocumentScrolling() {
  const root = document.documentElement;
  const body = document.body;

  TRANSIENT_CLASSES.forEach((className) => root.classList.remove(className));

  // Modal code may temporarily set these properties. Route changes and browser
  // back/forward restores must always return the document to native scrolling.
  body.style.removeProperty('overflow');
  body.style.removeProperty('overflow-y');
  body.style.removeProperty('overscroll-behavior');
  body.style.removeProperty('position');
  body.style.removeProperty('top');
  body.style.removeProperty('width');
}

export function MobileBrowserHygiene() {
  const pathname = usePathname();

  useEffect(() => {
    const media = window.matchMedia(RESPONSIVE_QUERY);

    function applyRouteState() {
      if (!media.matches) {
        restoreNativeDocumentScrolling();
        delete document.documentElement.dataset.mobileRouteSurface;
        delete document.documentElement.dataset.responsiveSurface;
        return;
      }

      restoreNativeDocumentScrolling();
      document.documentElement.dataset.responsiveSurface = 'mobile-tablet';
      document.documentElement.dataset.mobileRouteSurface = isPublicResponsiveRoute(pathname) ? 'auth' : 'application';
    }

    function handlePageShow() {
      applyRouteState();
    }

    applyRouteState();
    window.addEventListener('pageshow', handlePageShow);
    media.addEventListener?.('change', applyRouteState);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      media.removeEventListener?.('change', applyRouteState);
    };
  }, [pathname]);

  return null;
}
