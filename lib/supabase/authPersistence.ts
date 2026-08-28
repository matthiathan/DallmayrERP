import type { CookieOptions } from '@supabase/ssr';

export const AUTH_PERSISTENCE_COOKIE = 'dallmayrerp-auth-persistence';
export const AUTH_PERSISTENCE_KEY = 'dallmayrerp-auth-persistence';
export const AUTH_PERSISTENCE_SESSION = 'session';
export const AUTH_PERSISTENCE_DEVICE = 'device';
export const AUTH_PREFERENCE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function shouldRememberAuth(cookieValue: string | null | undefined) {
  return cookieValue !== AUTH_PERSISTENCE_SESSION;
}

export function applyAuthCookiePersistence(options: CookieOptions, remember: boolean): CookieOptions {
  const adjusted = { ...options };

  // Keep maxAge=0 removals intact, but turn newly written auth cookies into
  // browser-session cookies when the user has not selected Remember me.
  if (!remember && typeof adjusted.maxAge === 'number' && adjusted.maxAge > 0) {
    delete adjusted.maxAge;
    delete adjusted.expires;
  }

  return adjusted;
}
