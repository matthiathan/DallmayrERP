'use client';

import { useEffect, useState } from 'react';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/browserStorage';
import {
  defaultFavoriteLabel,
  parseFavoriteEntries,
  toggleFavoriteEntry,
  type FavoriteEntry,
} from '@/lib/navigation/favorites';

const FAVORITES_KEY = 'dallmayr-mobile-favorites-v1';
const RAIL_COLLAPSED_KEY = 'dallmayr-desktop-rail-collapsed-v1';

export function useAppShellPreferences() {
  const [favoriteEntries, setFavoriteEntries] = useState<FavoriteEntry[]>([]);
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    const parsed = parseFavoriteEntries(safeLocalStorageGet(FAVORITES_KEY));
    setFavoriteEntries(parsed);
    if (parsed.length > 0) safeLocalStorageSet(FAVORITES_KEY, JSON.stringify(parsed));
    setRailCollapsed(safeLocalStorageGet(RAIL_COLLAPSED_KEY) === 'true');
  }, []);

  function toggleFavorite(href: string, label?: string) {
    setFavoriteEntries((current) => {
      const next = toggleFavoriteEntry(current, {
        href,
        label: label?.trim() || defaultFavoriteLabel(href),
      });
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
    favoriteEntries,
    favoriteHrefs: favoriteEntries.map((entry) => entry.href),
    railCollapsed,
    toggleFavorite,
    toggleRail,
  };
}
