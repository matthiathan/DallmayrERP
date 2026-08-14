'use client';

import { useEffect, useState } from 'react';
import { canAccessShellPath } from '@/components/layout/appShellNavigation';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/browserStorage';
import {
  defaultFavoriteLabel,
  favoritePathname,
  parseFavoriteEntries,
  retainFavoriteEntries,
  toggleFavoriteEntry,
  type FavoriteEntry,
} from '@/lib/navigation/favorites';
import type { BusinessRole } from '@/types/dallmayrerp';

const FAVORITES_KEY = 'dallmayr-mobile-favorites-v1';
const RAIL_COLLAPSED_KEY = 'dallmayr-desktop-rail-collapsed-v1';

export function useAppShellPreferences(role?: BusinessRole) {
  const [favoriteEntries, setFavoriteEntries] = useState<FavoriteEntry[]>([]);
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    const parsed = parseFavoriteEntries(safeLocalStorageGet(FAVORITES_KEY));
    const accessible = role
      ? retainFavoriteEntries(parsed, (entry) => canAccessShellPath(role, favoritePathname(entry.href)))
      : parsed;
    setFavoriteEntries(accessible);
    if (parsed.length > 0 || accessible.length > 0) {
      safeLocalStorageSet(FAVORITES_KEY, JSON.stringify(accessible));
    }
    setRailCollapsed(safeLocalStorageGet(RAIL_COLLAPSED_KEY) === 'true');
  }, [role]);

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
