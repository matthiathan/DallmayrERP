'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const PHONE_QUERY = '(max-width: 900px)';
const PUBLIC_MOBILE_ROUTES = ['/login', '/onboarding'];
const TRANSIENT_CLASSES = [
  'mobile-navigation-dialog-open',
  'mobile-workflow-detail-open',
];

function isPublicMobileRoute(pathname: string) {
  return PUBLIC_MOBILE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function restoreNativeDocumentScrolling() {
  const root = document.documentElement;
  const body = document.body;

  TRANSIENT_CLASSES.forEach((className) => root.classList.remove(className));

  // These properties are only ever set by DallmayrERP mobile overlays. A route
  // change or browser back/forward restore must never leave the document locked.
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
    const media = window.matchMedia(PHONE_QUERY);

    function applyRouteState() {
      if (!media.matches) {
        delete document.documentElement.dataset.mobileRouteSurface;
        return;
      }

      restoreNativeDocumentScrolling();
      document.documentElement.dataset.mobileRouteSurface = isPublicMobileRoute(pathname) ? 'auth' : 'application';
    }

    function handlePageShow() {
      // Mobile Safari/Chrome can restore a page from the back-forward cache with
      // inline styles from an open modal. Reset those styles before interaction.
      applyRouteState();
    }

    applyRouteState();
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [pathname]);

  return null;
}
