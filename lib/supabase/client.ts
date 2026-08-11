import { createClient, SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

const AUTH_STORAGE_KEY = 'dallmayrerp-supabase-auth';
const AUTH_PERSISTENCE_KEY = 'dallmayrerp-auth-persistence';

function assertSafeSupabaseUrl(value: string) {
  const url = new URL(value);
  const isLocalDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  if (url.protocol !== 'https:' && !isLocalDevelopmentHost) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must use HTTPS outside local development.');
  }
}

function rememberOnThisDevice() {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(AUTH_PERSISTENCE_KEY) !== 'session';
}

function authStorage() {
  return {
    getItem(key: string) {
      if (typeof window === 'undefined') return null;
      const preferred = rememberOnThisDevice() ? window.localStorage : window.sessionStorage;
      const fallback = rememberOnThisDevice() ? window.sessionStorage : window.localStorage;
      return preferred.getItem(key) ?? fallback.getItem(key);
    },
    setItem(key: string, value: string) {
      if (typeof window === 'undefined') return;
      const target = rememberOnThisDevice() ? window.localStorage : window.sessionStorage;
      const other = rememberOnThisDevice() ? window.sessionStorage : window.localStorage;
      target.setItem(key, value);
      other.removeItem(key);
    },
    removeItem(key: string) {
      if (typeof window === 'undefined') return;
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    },
  };
}

export function getAuthRememberMePreference() {
  return rememberOnThisDevice();
}

export function setAuthRememberMePreference(remember: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUTH_PERSISTENCE_KEY, remember ? 'device' : 'session');

  // A new sign-in should never fall back to a session saved under the previous mode.
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

export function getSupabaseClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  assertSafeSupabaseUrl(url);

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: AUTH_STORAGE_KEY,
      storage: authStorage(),
    },
  });

  return browserClient;
}
