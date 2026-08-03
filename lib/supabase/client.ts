import { createClient, SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

function assertSafeSupabaseUrl(value: string) {
  const url = new URL(value);
  const isLocalDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  if (url.protocol !== 'https:' && !isLocalDevelopmentHost) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must use HTTPS outside local development.');
  }
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
      storageKey: 'dallmayrerp-supabase-auth',
    },
  });

  return browserClient;
}
