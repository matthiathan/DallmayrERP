'use client';

import { useEffect, useState } from 'react';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/browserStorage';

const FAVORITES_KEY = 'dallmayr-mobile-favorites-v1';
const RAIL_COLLAPSED_KEY = 'dallmayr-desktop-rail-collapsed-v1';
const MAX_FAVORITES = 4;

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

export function useAppShellPreferences() {
  const [favoriteHrefs, setFavoriteHrefs] = useState<string[]>([]);
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    setFavoriteHrefs(safeFavoriteList(safeLocalStorageGet(FAVORITES_KEY)));
    setRailCollapsed(safeLocalStorageGet(RAIL_COLLAPSED_KEY) === 'true');
  }, []);

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

  return {
    favoriteHrefs,
    railCollapsed,
    toggleFavorite,
    toggleRail,
  };
}
