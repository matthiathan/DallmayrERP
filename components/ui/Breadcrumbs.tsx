'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { usePageNavigationMetadata } from '@/components/layout/PageNavigationMetadata';
import { buildPageNavigation } from '@/lib/navigation/pageNavigation';
import { TODAY_LABEL } from '@/lib/navigation/terminology';

export function Breadcrumbs() {
  const pathname = usePathname();
  const metadata = usePageNavigationMetadata(pathname);
  const navigation = useMemo(
    () => buildPageNavigation(pathname, metadata),
    [metadata, pathname],
  );

  if (!pathname) return null;

  const isRoot = pathname === '/';
  const isWorkspace = pathname === '/workspace';
  const showSectionIndex = navigation.sections.length >= 2;

  return (
    <>
      {!isRoot && !isWorkspace ? (
        <nav aria-label="Back navigation" className="mobile-page-navigation">
          <Link className="mobile-page-back" href={navigation.backTarget.href}>
            <span aria-hidden="true">←</span>
            <span>Back to {navigation.backTarget.label}</span>
          </Link>
          <span className="mobile-page-current">{navigation.currentLabel}</span>
        </nav>
      ) : null}

      {showSectionIndex ? (
        <nav aria-label="On this page" className="mobile-section-index">
          {navigation.sections.map((section) => (
            <a href={`#${section.id}`} key={section.id}>{section.label}</a>
          ))}
        </nav>
      ) : null}

      {!isRoot && !isWorkspace ? (
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          <Link href="/workspace">{TODAY_LABEL}</Link>
          {navigation.crumbs.map((crumb) => (
            <span className="breadcrumb-item" key={crumb.href}>
              <span aria-hidden="true">/</span>
              {crumb.isLast ? <span aria-current="page">{crumb.label}</span> : <Link href={crumb.href}>{crumb.label}</Link>}
            </span>
          ))}
        </nav>
      ) : null}
    </>
  );
}
