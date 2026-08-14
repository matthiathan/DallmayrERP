export const MAX_FAVORITES = 8;

export type FavoriteEntry = {
  href: string;
  label: string;
};

function cleanHref(value: unknown) {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  return href;
}

export function favoritePathname(href: string) {
  const clean = cleanHref(href);
  if (!clean) return '/';
  return clean.split(/[?#]/, 1)[0] || '/';
}

export function favoriteHrefForLocation(pathname: string, search = '') {
  const cleanPath = cleanHref(pathname) ?? '/';
  const cleanSearch = search.trim();
  if (!cleanSearch || cleanSearch === '?') return cleanPath;
  return `${cleanPath}${cleanSearch.startsWith('?') ? cleanSearch : `?${cleanSearch}`}`;
}

export function defaultFavoriteLabel(href: string) {
  const pathname = favoritePathname(href);
  const segments = pathname.split('/').filter(Boolean);
  const last = segments.at(-1) ?? 'Today';
  const decoded = (() => {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  })();
  return decoded
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Today';
}

function normalizeEntry(value: unknown): FavoriteEntry | null {
  if (typeof value === 'string') {
    const href = cleanHref(value);
    return href ? { href, label: defaultFavoriteLabel(href) } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<FavoriteEntry>;
  const href = cleanHref(candidate.href);
  if (!href) return null;
  const label = typeof candidate.label === 'string' && candidate.label.trim()
    ? candidate.label.trim()
    : defaultFavoriteLabel(href);
  return { href, label };
}

export function parseFavoriteEntries(value: string | null) {
  if (!value) return [] as FavoriteEntry[];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [] as FavoriteEntry[];
    const seen = new Set<string>();
    const entries: FavoriteEntry[] = [];
    parsed.forEach((item) => {
      const entry = normalizeEntry(item);
      if (!entry || seen.has(entry.href) || entries.length >= MAX_FAVORITES) return;
      seen.add(entry.href);
      entries.push(entry);
    });
    return entries;
  } catch {
    return [] as FavoriteEntry[];
  }
}

export function retainFavoriteEntries(current: FavoriteEntry[], isAllowed: (entry: FavoriteEntry) => boolean) {
  return current.filter(isAllowed).slice(0, MAX_FAVORITES);
}

export function toggleFavoriteEntry(current: FavoriteEntry[], entry: FavoriteEntry) {
  const normalized = normalizeEntry(entry);
  if (!normalized) return current;
  if (current.some((item) => item.href === normalized.href)) {
    return current.filter((item) => item.href !== normalized.href);
  }
  if (current.length >= MAX_FAVORITES) return current;
  return [...current, normalized];
}
