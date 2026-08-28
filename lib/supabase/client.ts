import {
  createBrowserClient,
  parseCookieHeader,
  serializeCookieHeader,
} from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyAuthCookiePersistence,
  AUTH_PERSISTENCE_COOKIE,
  AUTH_PERSISTENCE_DEVICE,
  AUTH_PERSISTENCE_KEY,
  AUTH_PERSISTENCE_SESSION,
  AUTH_PREFERENCE_MAX_AGE_SECONDS,
  shouldRememberAuth,
} from '@/lib/supabase/authPersistence';

let browserClient: SupabaseClient | null = null;

function assertSafeSupabaseUrl(value: string) {
  const url = new URL(value);
  const isLocalDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  if (url.protocol !== 'https:' && !isLocalDevelopmentHost) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must use HTTPS outside local development.');
  }
}

function rememberOnThisDevice() {
  if (typeof window === 'undefined') return true;
  const preferenceCookie = parseCookieHeader(document.cookie)
    .find(({ name }) => name === AUTH_PERSISTENCE_COOKIE)?.value;
  return shouldRememberAuth(preferenceCookie ?? window.localStorage.getItem(AUTH_PERSISTENCE_KEY));
}

export function getAuthRememberMePreference() {
  return rememberOnThisDevice();
}

export function setAuthRememberMePreference(remember: boolean) {
  if (typeof window === 'undefined') return;
  const value = remember ? AUTH_PERSISTENCE_DEVICE : AUTH_PERSISTENCE_SESSION;
  window.localStorage.setItem(AUTH_PERSISTENCE_KEY, value);
  document.cookie = serializeCookieHeader(AUTH_PERSISTENCE_COOKIE, value, {
    path: '/',
    sameSite: 'lax',
    secure: window.location.protocol === 'https:',
    maxAge: AUTH_PREFERENCE_MAX_AGE_SECONDS,
  });
}

export function getSupabaseClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publicKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or a public Supabase API key');
  }
  assertSafeSupabaseUrl(url);

  browserClient = createBrowserClient(url, publicKey, {
    cookieOptions: {
      path: '/',
      sameSite: 'lax',
      secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
    },
    cookies: {
      getAll() {
        return typeof document === 'undefined' ? [] : parseCookieHeader(document.cookie);
      },
      setAll(cookiesToSet) {
        if (typeof document === 'undefined') return;
        const remember = rememberOnThisDevice();
        cookiesToSet.forEach(({ name, value, options }) => {
          document.cookie = serializeCookieHeader(
            name,
            value,
            applyAuthCookiePersistence(options, remember),
          );
        });
      },
    },
  });

  return browserClient;
}
