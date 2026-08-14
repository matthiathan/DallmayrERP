'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { PageNavigationMetadata as PageNavigationMetadataValue } from '@/lib/navigation/pageNavigation';

type Registration = {
  metadata: PageNavigationMetadataValue;
  owner: symbol;
  pathname: string;
};

let registration: Registration | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function registerPageNavigation(pathname: string, owner: symbol, metadata: PageNavigationMetadataValue) {
  registration = { pathname, owner, metadata };
  emitChange();

  return () => {
    if (registration?.owner !== owner) return;
    registration = null;
    emitChange();
  };
}

export function usePageNavigationMetadata(pathname: string) {
  return useSyncExternalStore(
    subscribe,
    () => registration?.pathname === pathname ? registration.metadata : null,
    () => null,
  );
}

export function PageNavigationMetadata({ metadata }: { metadata: PageNavigationMetadataValue }) {
  const pathname = usePathname();
  const ownerRef = useRef<symbol | null>(null);
  if (!ownerRef.current) ownerRef.current = Symbol('page-navigation-metadata');

  useEffect(() => registerPageNavigation(pathname, ownerRef.current as symbol, metadata), [metadata, pathname]);
  return null;
}

export function PageSectionAnchor({ id }: { id: string }) {
  return <span aria-hidden="true" className="page-section-anchor" id={id} />;
}
